"""External review actions must honor target department and linked record access."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.external_review_workflow import create_approval, create_task, mark_seen, reject_item


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


@pytest.mark.parametrize("action", ["seen", "reject", "task", "approval"])
def test_manager_global_read_does_not_allow_foreign_review_writes(context, action):
    db, front, maintenance, _, manager, _ = context
    item = new_item(db, maintenance.id, f"foreign-source-{action}")
    # Managers can read the organization-wide review queue, but they may
    # mutate neither foreign source records nor redirect them to their team.
    def attempt():
        if action == "seen":
            return mark_seen(db, manager, item.id, "Seen by wrong department")
        if action == "reject":
            return reject_item(db, manager, item.id, "Rejected by wrong department")
        if action == "task":
            return create_task(db, manager, item.id, department_id=front.id)
        return create_approval(db, manager, item.id, department_id=front.id)

    with pytest.raises(HTTPException) as exc:
        attempt()
    assert exc.value.status_code == 403
    db.refresh(item)
    assert item.status == "For Review"
    assert item.linked_task_id is None
    assert item.linked_approval_id is None
    assert db.query(models.Task).count() == 0
    assert db.query(models.Approval).count() == 0
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("action", ["seen", "reject", "task", "approval"])
def test_manager_cannot_change_unscoped_review_item(context, action):
    db, front, _, _, manager, _ = context
    item = new_item(db, None, f"unscoped-source-{action}")
    def attempt():
        if action == "seen":
            return mark_seen(db, manager, item.id)
        if action == "reject":
            return reject_item(db, manager, item.id, "Cannot reject global source")
        if action == "task":
            return create_task(db, manager, item.id, department_id=front.id)
        return create_approval(db, manager, item.id, department_id=front.id)

    with pytest.raises(HTTPException) as exc:
        attempt()
    assert exc.value.status_code == 403
    db.refresh(item)
    assert item.status == "For Review"
    assert db.query(models.Task).count() == 0
    assert db.query(models.Approval).count() == 0


def test_staff_cannot_mark_review_seen_or_append_manager_note(context):
    db, front, _, _, _, _ = context
    staff = models.User(name="Front Desk Staff", role="staff", department_id=front.id, is_active=True)
    db.add(staff)
    db.commit()
    item = new_item(db, front.id, "staff-must-not-mark-seen")
    with pytest.raises(HTTPException) as exc:
        mark_seen(db, staff, item.id, "Unauthorized note")
    assert exc.value.status_code == 403
    db.refresh(item)
    assert item.status == "For Review"
    assert item.summary is None
    assert db.query(models.ActivityLog).count() == 0


def test_manager_can_mark_seen_and_reject_own_department(context):
    db, front, _, _, manager, _ = context
    item = new_item(db, front.id, "manager-scope-happy-path")
    seen = mark_seen(db, manager, item.id, "Checked")
    assert seen.status == "Seen"
    assert "Checked" in seen.summary
    rejected = reject_item(db, manager, item.id, "Not actionable")
    assert rejected.status == "Rejected"
    assert db.query(models.ActivityLog).count() == 2


def test_manager_membership_grants_source_write_permission(context):
    db, _, maintenance, _, manager, _ = context
    db.add(models.UserDepartment(
        user_id=manager.id, department_id=maintenance.id, is_primary=False
    ))
    db.commit()
    item = new_item(db, maintenance.id, "additional-source-membership")
    assert mark_seen(db, manager, item.id).status == "Seen"


def test_owner_can_review_cross_department_sources(context):
    db, front, maintenance, owner, _, _ = context
    seen_item = new_item(db, maintenance.id, "owner-cross-dept-seen")
    assert mark_seen(db, owner, seen_item.id).status == "Seen"
    task_item = new_item(db, maintenance.id, "owner-cross-dept-task")
    task, _ = create_task(db, owner, task_item.id, department_id=front.id)
    assert task.department_id == front.id
    approval_item = new_item(db, maintenance.id, "owner-cross-dept-approval")
    approval, _ = create_approval(db, owner, approval_item.id, department_id=front.id)
    assert approval.department_id == front.id
    reject_item_row = new_item(db, maintenance.id, "owner-cross-dept-reject")
    assert reject_item(db, owner, reject_item_row.id, "Declined").status == "Rejected"
