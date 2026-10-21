"""Generic resource links are validated against actual target visibility and identity."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.authorized_crud import create_resource_authorized, update_resource_authorized


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front = models.Department(name="Reception")
    kitchen = models.Department(name="Kitchen")
    db.add_all([front, kitchen])
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    lead = models.User(name="Reception Lead", role="lead", department_id=front.id, is_active=True)
    manager = models.User(name="Kitchen Manager", role="manager", department_id=kitchen.id, is_active=True)
    db.add_all([owner, lead, manager])
    db.flush()
    db.add(models.UserDepartment(user_id=lead.id, department_id=front.id, is_primary=True))
    db.add(models.UserDepartment(user_id=manager.id, department_id=kitchen.id, is_primary=True))
    db.commit()
    try:
        yield db, front, kitchen, owner, lead, manager
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize("resource,model,link_field,target_model", [
    ("requests", models.Request, "linked_task_id", models.Task),
    ("requests", models.Request, "linked_project_id", models.Project),
    ("tasks", models.Task, "project_id", models.Project),
    ("tasks", models.Task, "linked_fix_id", models.Fix),
    ("tasks", models.Task, "linked_guest_note_id", models.GuestNote),
    ("tasks", models.Task, "linked_post_id", models.Post),
    ("shift-notes", models.ShiftNote, "linked_task_id", models.Task),
    ("shift-notes", models.ShiftNote, "linked_fix_id", models.Fix),
    ("shift-notes", models.ShiftNote, "linked_guest_note_id", models.GuestNote),
    ("guests", models.GuestNote, "linked_task_id", models.Task),
    ("fixes", models.Fix, "linked_task_id", models.Task),
    ("posts", models.Post, "project_id", models.Project),
])
def test_cannot_attach_guessed_foreign_record_id_on_create(
    context, resource, model, link_field, target_model,
):
    db, front, kitchen, _, lead, _ = context
    target = target_model(title="Kitchen confidential", department_id=kitchen.id)
    db.add(target)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(
            resource,
            {"title": "Front work", "department_id": front.id, link_field: target.id},
            user=lead, db=db,
        )
    assert exc.value.status_code == 403
    # Reusing the same Session later cannot persist a partial failed write.
    db.commit()
    assert db.query(model).count() == (1 if model is target_model else 0)
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("resource,model,field,target_model", [
    ("tasks", models.Task, "project_id", models.Project),
    ("requests", models.Request, "linked_project_id", models.Project),
    ("guests", models.GuestNote, "linked_task_id", models.Task),
    ("fixes", models.Fix, "linked_task_id", models.Task),
])
def test_patch_rejects_foreign_reference_without_mutating_title(
    context, resource, model, field, target_model,
):
    db, front, kitchen, _, lead, _ = context
    local = model(title="Original title", department_id=front.id)
    foreign = target_model(title="Foreign source", department_id=kitchen.id)
    db.add_all([local, foreign])
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            resource, local.id,
            {"title": "Overwritten", field: foreign.id},
            user=lead, db=db,
        )
    assert exc.value.status_code == 403
    db.commit()
    db.refresh(local)
    assert local.title == "Original title"
    assert getattr(local, field) is None
    assert db.query(models.ActivityLog).count() == 0


def test_missing_linked_id_cannot_be_saved_even_when_fks_unenforced(context):
    db, front, _, owner, _, _ = context
    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(
            "tasks", {"title": "Missing project", "department_id": front.id, "project_id": 999999},
            user=owner, db=db,
        )
    assert exc.value.status_code == 409
    db.commit()
    assert db.query(models.Task).count() == 0
    assert db.query(models.ActivityLog).count() == 0


def test_request_prelinked_task_must_belong_to_same_department(context):
    db, front, kitchen, owner, _, _ = context
    foreign = models.Task(title="Kitchen task", department_id=kitchen.id)
    db.add(foreign)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(
            "requests",
            {"title": "Front request", "department_id": front.id, "linked_task_id": foreign.id},
            user=owner, db=db,
        )
    assert exc.value.status_code == 409
    assert "department does not match" in str(exc.value.detail)
    db.commit()
    assert db.query(models.Request).count() == 0


def test_request_department_transfer_rechecks_existing_link(context):
    db, front, kitchen, owner, _, _ = context
    task = models.Task(title="Front task", department_id=front.id)
    request = models.Request(title="Front request", department_id=front.id)
    db.add_all([task, request])
    db.flush()
    request.linked_task_id = task.id
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            "requests", request.id,
            {"department_id": kitchen.id, "title": "Moved into kitchen"},
            user=owner, db=db,
        )
    assert exc.value.status_code == 409
    db.commit()
    db.refresh(request)
    assert request.department_id == front.id
    assert request.linked_task_id == task.id
    assert request.title == "Front request"
    assert db.query(models.ActivityLog).count() == 0


def test_same_department_project_and_task_link_remains_valid(context):
    db, front, _, _, lead, _ = context
    project = models.Project(title="Room makeover", department_id=front.id)
    db.add(project)
    db.commit()
    created = create_resource_authorized(
        "tasks",
        {"title": "Order curtain fabric", "department_id": front.id, "project_id": project.id},
        user=lead, db=db,
    )
    assert created["project_id"] == project.id
    modified = update_resource_authorized(
        "tasks", created["id"], {"project_id": None}, user=lead, db=db,
    )
    assert modified["project_id"] is None


def test_manager_global_read_allows_intentional_cross_department_project_link(context):
    db, front, kitchen, _, _, manager = context
    project = models.Project(title="Shared hospitality event", department_id=front.id)
    db.add(project)
    db.commit()
    created = create_resource_authorized(
        "tasks",
        {"title": "Kitchen prep", "department_id": kitchen.id, "project_id": project.id},
        user=manager, db=db,
    )
    assert created["project_id"] == project.id


def test_valid_request_prelinked_task_remains_supported(context):
    db, front, _, _, lead, _ = context
    task = models.Task(title="Linked first", department_id=front.id)
    db.add(task)
    db.commit()
    result = create_resource_authorized(
        "requests",
        {"title": "Approved later", "department_id": front.id, "linked_task_id": task.id},
        user=lead, db=db,
    )
    assert result["linked_task_id"] == task.id


def test_unrelated_legacy_edit_does_not_revalidate_unchanged_reference(context):
    db, front, kitchen, owner, lead, _ = context
    foreign = models.Project(title="Old cross-team project", department_id=kitchen.id)
    task = models.Task(title="Legacy task", department_id=front.id)
    db.add_all([foreign, task])
    db.flush()
    task.project_id = foreign.id
    db.commit()
    result = update_resource_authorized(
        "tasks", task.id, {"title": "Updated task note"}, user=lead, db=db,
    )
    assert result["title"] == "Updated task note"
    assert result["project_id"] == foreign.id
