"""Assignments must not notify employees about records they cannot access."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app import foundation_models as foundation
from app.routers.authorized_crud import create_resource_authorized, update_resource_authorized


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front = models.Department(name="Reception")
    maintenance = models.Department(name="Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    lead = models.User(name="Lead", role="lead", department_id=front.id, is_active=True)
    front_staff = models.User(name="Front Staff", role="staff", department_id=front.id, is_active=True)
    maintenance_staff = models.User(name="Maintenance Staff", role="staff", department_id=maintenance.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=maintenance.id, is_active=True)
    inactive = models.User(name="Inactive", role="staff", department_id=front.id, is_active=False)
    db.add_all([owner, lead, front_staff, maintenance_staff, manager, inactive])
    db.flush()
    for person, dept in ((lead, front), (front_staff, front), (maintenance_staff, maintenance), (manager, maintenance), (inactive, front)):
        db.add(models.UserDepartment(user_id=person.id, department_id=dept.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, lead, front_staff, maintenance_staff, manager, inactive
    finally:
        db.close()
        engine.dispose()


def assert_no_side_effects(db, expected_rows):
    # Reusing a Session after a rejected API request cannot write a hidden edit.
    db.commit()
    assert db.query(models.Task).count() == expected_rows
    assert db.query(foundation.Notification).count() == 0
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("role", ["lead", "owner"])
def test_create_rejects_assignment_to_person_outside_task_department(context, role):
    db, front, _, owner, lead, _, maintenance_staff, _, _ = context
    actor = lead if role == "lead" else owner
    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(
            "tasks",
            {"title": "Private guest arrival notes", "department_id": front.id, "assigned_to_id": maintenance_staff.id},
            user=actor, db=db,
        )
    assert exc.value.status_code == 403
    assert_no_side_effects(db, 0)


def test_update_cannot_send_assignment_notification_to_outside_department(context):
    db, front, _, owner, lead, _, maintenance_staff, _, _ = context
    task = models.Task(title="Confidential guest details", department_id=front.id)
    db.add(task)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            "tasks", task.id,
            {"assigned_to_id": maintenance_staff.id, "title": "Unlawfully shared"},
            user=lead, db=db,
        )
    assert exc.value.status_code == 403
    assert_no_side_effects(db, 1)
    db.refresh(task)
    assert task.assigned_to_id is None
    assert task.title == "Confidential guest details"


def test_department_transfer_cannot_strand_existing_assignee(context):
    db, front, maintenance, owner, _, front_staff, _, _, _ = context
    task = models.Task(title="Reception duty", department_id=front.id, assigned_to_id=front_staff.id)
    db.add(task)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            "tasks", task.id, {"department_id": maintenance.id}, user=owner, db=db,
        )
    assert exc.value.status_code == 403
    db.commit()
    db.refresh(task)
    assert task.department_id == front.id
    assert task.assigned_to_id == front_staff.id
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("role", ["owner", "lead"])
def test_valid_same_department_assignment_is_notified(context, role):
    db, front, _, owner, lead, front_staff, _, _, _ = context
    actor = owner if role == "owner" else lead
    result = create_resource_authorized(
        "tasks",
        {"title": "Prepare room 4", "department_id": front.id, "assigned_to_id": front_staff.id},
        user=actor, db=db,
    )
    assert result["assigned_to_id"] == front_staff.id
    notices = db.query(foundation.Notification).all()
    assert len(notices) == 1
    assert notices[0].user_id == front_staff.id
    assert "Prepare room 4" in notices[0].title


def test_secondary_department_membership_allows_cross_team_assignment(context):
    db, front, _, owner, _, _, maintenance_staff, _, _ = context
    db.add(models.UserDepartment(
        user_id=maintenance_staff.id, department_id=front.id, is_primary=False,
    ))
    db.commit()
    task = create_resource_authorized(
        "tasks",
        {"title": "Both departments", "department_id": front.id, "assigned_to_id": maintenance_staff.id},
        user=owner, db=db,
    )
    assert task["assigned_to_id"] == maintenance_staff.id
    assert db.query(foundation.Notification).count() == 1


def test_manager_global_read_permission_allows_cross_department_assignment(context):
    db, front, _, owner, _, _, _, manager, _ = context
    task = create_resource_authorized(
        "tasks",
        {"title": "Management review", "department_id": front.id, "assigned_to_id": manager.id},
        user=owner, db=db,
    )
    assert task["assigned_to_id"] == manager.id


@pytest.mark.parametrize("assignee", ["inactive", "missing"])
def test_inactive_or_missing_assignee_cannot_be_newly_assigned(context, assignee):
    db, front, _, owner, _, _, _, _, inactive = context
    target = inactive.id if assignee == "inactive" else 987654
    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(
            "tasks",
            {"title": "Bad assignment", "department_id": front.id, "assigned_to_id": target},
            user=owner, db=db,
        )
    assert exc.value.status_code == 422
    assert_no_side_effects(db, 0)


def test_editor_can_update_title_without_revalidating_unchanged_legacy_assignment(context):
    db, front, _, owner, lead, _, maintenance_staff, _, _ = context
    legacy = models.Task(
        title="Legacy duty", department_id=front.id, assigned_to_id=maintenance_staff.id,
    )
    db.add(legacy)
    db.commit()
    changed = update_resource_authorized(
        "tasks", legacy.id, {"title": "Clarified legacy duty"}, user=lead, db=db,
    )
    assert changed["title"] == "Clarified legacy duty"
    assert changed["assigned_to_id"] == maintenance_staff.id
    assert db.query(foundation.Notification).count() == 0


@pytest.mark.parametrize("resource,model", [
    ("requests", models.Request),
    ("fixes", models.Fix),
    ("guests", models.GuestNote),
])
def test_other_assigned_resources_follow_same_department_visibility_rule(context, resource, model):
    db, front, _, owner, _, _, maintenance_staff, _, _ = context
    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(
            resource,
            {"title": "Scoped operational content", "department_id": front.id, "assigned_to_id": maintenance_staff.id},
            user=owner, db=db,
        )
    assert exc.value.status_code == 403
    db.commit()
    assert db.query(model).count() == 0
    assert db.query(foundation.Notification).count() == 0
