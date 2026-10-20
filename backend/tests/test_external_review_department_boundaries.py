"""External review actions must honor target department and linked record access."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.external_review_workflow import create_approval, create_task


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    front = models.Department(name="Front Desk")
    maintenance = models.Department(name="Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    manager = models.User(name="Front Manager", role="manager", department_id=front.id, is_active=True)
    lead = models.User(name="Front Lead", role="lead", department_id=front.id, is_active=True)
    db.add_all([owner, manager, lead])
    db.flush()
    db.add(models.UserDepartment(user_id=manager.id, department_id=front.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, manager, lead
    finally:
        db.close()
        engine.dispose()


def new_item(db, department_id, suffix):
    item = models.ExternalReviewItem(
        external_source="accounting_program",
        external_id=f"cross-department-{suffix}",
        source_app="accounting_program",
        event_type="approval.pending",
        title=f"External item {suffix}",
        status="For Review",
        department_id=department_id,
    )
    db.add(item)
    db.commit()
    return item


def test_manager_cannot_create_approval_in_other_department(context):
    db, front, maintenance, _, manager, _ = context
    item = new_item(db, front.id, "unauthorized-approval")
    with pytest.raises(HTTPException) as exc:
        create_approval(db, manager, item.id, department_id=maintenance.id)
    assert exc.value.status_code == 403
    assert db.query(models.Approval).count() == 0
    db.refresh(item)
    assert item.status == "For Review"
    assert item.linked_approval_id is None


def test_manager_can_create_scoped_approval_and_retry_without_duplicates(context):
    db, front, maintenance, _, manager, _ = context
    item = new_item(db, front.id, "authorized-approval")
    first, _ = create_approval(db, manager, item.id)
    count = db.query(models.ActivityLog).count()
    same, _ = create_approval(db, manager, item.id)
    assert first.id == same.id
    assert first.department_id == front.id
    assert db.query(models.Approval).count() == 1
    assert db.query(models.ActivityLog).count() == count
    with pytest.raises(HTTPException) as exc:
        create_approval(db, manager, item.id, department_id=maintenance.id)
    assert exc.value.status_code == 409
    assert db.query(models.Approval).count() == 1


def test_manager_cannot_read_or_reuse_existing_other_department_approval(context):
    db, front, maintenance, owner, manager, _ = context
    item = new_item(db, front.id, "foreign-approval")
    foreign, _ = create_approval(db, owner, item.id, department_id=maintenance.id)
    assert foreign.department_id == maintenance.id
    with pytest.raises(HTTPException) as exc:
        create_approval(db, manager, item.id)
    assert exc.value.status_code == 403
    assert db.query(models.Approval).count() == 1


def test_manager_additional_membership_allows_approval_in_second_department(context):
    db, front, maintenance, _, manager, _ = context
    db.add(models.UserDepartment(
        user_id=manager.id, department_id=maintenance.id, is_primary=False
    ))
    db.commit()
    item = new_item(db, front.id, "multiple-memberships")
    approval, _ = create_approval(db, manager, item.id, department_id=maintenance.id)
    assert approval.department_id == maintenance.id


def test_manager_cannot_make_unscoped_approval_but_owner_can(context):
    db, _, _, owner, manager, _ = context
    item = new_item(db, None, "unscoped")
    with pytest.raises(HTTPException) as exc:
        create_approval(db, manager, item.id)
    assert exc.value.status_code == 403
    approval, _ = create_approval(db, owner, item.id)
    assert approval.department_id is None


def test_approval_management_capability_is_still_required(context):
    db, front, _, _, _, lead = context
    item = new_item(db, front.id, "lead-denied")
    with pytest.raises(HTTPException) as exc:
        create_approval(db, lead, item.id)
    assert exc.value.status_code == 403


def test_task_retry_authorizes_existing_department_not_requested_default(context):
    db, front, maintenance, owner, _, lead = context
    item = new_item(db, front.id, "foreign-task")
    foreign, _ = create_task(db, owner, item.id, department_id=maintenance.id)
    count = db.query(models.ActivityLog).count()
    with pytest.raises(HTTPException) as exc:
        create_task(db, lead, item.id)
    assert exc.value.status_code == 403
    assert db.query(models.Task).count() == 1
    assert db.query(models.ActivityLog).count() == count
    assert foreign.department_id == maintenance.id


def test_task_retry_cannot_reroute_linked_task(context):
    db, front, maintenance, owner, _, _ = context
    item = new_item(db, front.id, "task-reroute")
    task, _ = create_task(db, owner, item.id)
    with pytest.raises(HTTPException) as exc:
        create_task(db, owner, item.id, department_id=maintenance.id)
    assert exc.value.status_code == 409
    assert db.query(models.Task).count() == 1
    assert db.get(models.Task, task.id).department_id == front.id


def test_same_department_task_retry_preserves_idempotency(context):
    db, front, _, _, manager, _ = context
    item = new_item(db, front.id, "task-retry")
    first, _ = create_task(db, manager, item.id)
    next_task, _ = create_task(db, manager, item.id)
    assert first.id == next_task.id
    assert db.query(models.Task).count() == 1
