"""Request workflow must never return or reuse inconsistent linked records."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.request_workflow import plan_request, submit_request


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
    manager = models.User(name="Front manager", role="manager", department_id=front.id, is_active=True)
    db.add_all([owner, manager])
    db.flush()
    db.add(models.UserDepartment(user_id=manager.id, department_id=front.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, manager
    finally:
        db.close()
        engine.dispose()


def new_request(db, department_id, status):
    request = models.Request(title="Repair supplies", department_id=department_id, status=status)
    db.add(request)
    db.commit()
    return request


def pending_approval(db, request, department_id):
    approval = models.Approval(
        title="Approve supplies", source_type="ops_need", source_id=request.id,
        department_id=department_id, status="Pending",
    )
    db.add(approval)
    db.commit()
    return approval


def assert_request_unchanged(db, request, status):
    # Retained Sessions must not commit half a rejected workflow.
    db.commit()
    db.refresh(request)
    assert request.status == status
    assert request.requested_by_id is None
    assert request.linked_task_id is None
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("actor", ["owner", "manager"])
def test_submit_rejects_wrong_department_approval_without_partial_change(context, actor):
    db, front, maintenance, owner, manager = context
    request = new_request(db, front.id, "Draft")
    foreign = pending_approval(db, request, maintenance.id)
    with pytest.raises(HTTPException) as exc:
        submit_request(db, owner if actor == "owner" else manager, request.id, "Submit")
    assert exc.value.status_code == 409
    assert_request_unchanged(db, request, "Draft")
    assert db.query(models.Approval).count() == 1
    db.refresh(foreign)
    assert foreign.status == "Pending"


def test_submit_rejects_multiple_pending_approvals_instead_of_arbitrary_reuse(context):
    db, front, _, owner, _ = context
    request = new_request(db, front.id, "Draft")
    pending_approval(db, request, front.id)
    pending_approval(db, request, front.id)
    with pytest.raises(HTTPException) as exc:
        submit_request(db, owner, request.id, "Retry")
    assert exc.value.status_code == 409
    assert_request_unchanged(db, request, "Draft")
    assert db.query(models.Approval).count() == 2


def test_submit_reuses_correct_pending_approval_without_duplicate(context):
    db, front, _, _, manager = context
    request = new_request(db, front.id, "Draft")
    original = pending_approval(db, request, front.id)
    result, approval = submit_request(db, manager, request.id, "Ready")
    assert result.status == "Review"
    assert approval.id == original.id
    assert db.query(models.Approval).count() == 1
    assert db.query(models.ActivityLog).filter_by(entity_type="approvals", action="created").count() == 0


def test_normal_submission_creates_only_one_pending_approval(context):
    db, front, _, _, manager = context
    request = new_request(db, front.id, "Draft")
    updated, approval = submit_request(db, manager, request.id)
    assert updated.status == "Review"
    assert approval.department_id == front.id
    assert db.query(models.Approval).count() == 1


@pytest.mark.parametrize("actor", ["owner", "manager"])
def test_plan_cannot_reuse_task_from_different_department(context, actor):
    db, front, maintenance, owner, manager = context
    request = new_request(db, front.id, "Approved")
    foreign = models.Task(title="Maintenance confidential", department_id=maintenance.id)
    db.add(foreign)
    db.flush()
    request.linked_task_id = foreign.id
    db.commit()
    with pytest.raises(HTTPException) as exc:
        plan_request(db, owner if actor == "owner" else manager, request.id)
    assert exc.value.status_code == 409
    db.commit()
    db.refresh(request)
    assert request.status == "Approved"
    assert request.linked_task_id == foreign.id
    assert db.query(models.Task).count() == 1
    assert db.query(models.ActivityLog).count() == 0


def test_plan_cannot_replace_missing_linked_task_with_duplicate(context):
    db, front, _, owner, _ = context
    request = new_request(db, front.id, "Approved")
    request.linked_task_id = 90099
    db.commit()
    with pytest.raises(HTTPException) as exc:
        plan_request(db, owner, request.id)
    assert exc.value.status_code == 409
    db.commit()
    db.refresh(request)
    assert request.status == "Approved"
    assert db.query(models.Task).count() == 0
    assert db.query(models.ActivityLog).count() == 0


def test_valid_existing_task_is_reused_without_duplication(context):
    db, front, _, _, manager = context
    request = new_request(db, front.id, "Approved")
    task = models.Task(title="Already generated", department_id=front.id, status="To Do")
    db.add(task)
    db.flush()
    request.linked_task_id = task.id
    db.commit()

    planned, reused_task = plan_request(db, manager, request.id)
    assert planned.status == "Planned"
    assert reused_task.id == task.id
    assert db.query(models.Task).count() == 1
    assert db.query(models.ActivityLog).filter_by(entity_type="tasks", action="created").count() == 0


def test_plan_without_existing_task_still_creates_one(context):
    db, front, _, owner, _ = context
    request = new_request(db, front.id, "Approved")
    updated, task = plan_request(db, owner, request.id)
    assert updated.status == "Planned"
    assert updated.linked_task_id == task.id
    assert task.department_id == front.id
    assert db.query(models.Task).count() == 1
