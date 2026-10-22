"""Archived requests, approvals and submissions cannot be decided invisibly."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.services.approval_workflow import decide_approval
from app.services.request_workflow import complete_request, plan_request, submit_request
from app.services.submission_workflow import decide_submission


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    department = models.Department(name="Operations")
    db.add(department)
    db.flush()
    owner = models.User(
        name="Owner", email="archived-decision-owner@example.com",
        role="owner", department_id=department.id, is_active=True,
    )
    db.add(owner)
    db.commit()
    try:
        yield db, owner, department
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize("status,action", [
    ("Draft", "submit"),
    ("Approved", "plan"),
    ("Planned", "complete"),
])
def test_archived_request_cannot_advance(context, status, action):
    db, owner, department = context
    row = models.Request(
        title="Archived request", department_id=department.id,
        status=status, hidden_from_active=True, archived_at=utc_now(),
        archive_reason="manually_archived",
    )
    db.add(row)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        if action == "submit":
            submit_request(db, owner, row.id)
        elif action == "plan":
            plan_request(db, owner, row.id)
        else:
            complete_request(db, owner, row.id)
    assert exc.value.status_code == 409
    assert "Archived Request" in str(exc.value.detail)
    db.commit()
    db.refresh(row)
    assert row.status == status
    assert row.hidden_from_active is True
    assert row.archive_reason == "manually_archived"
    assert db.query(models.Approval).count() == 0
    assert db.query(models.Task).count() == 0
    assert db.query(models.ActivityLog).count() == 0


def test_archived_pending_approval_cannot_be_decided(context):
    db, owner, department = context
    row = models.Approval(
        title="Archived pending approval", department_id=department.id,
        status="Pending", hidden_from_active=True,
        archived_at=utc_now(), archive_reason="manual_archive",
    )
    db.add(row)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        decide_approval(db, owner, row.id, "Approved", "Invisible decision")
    assert exc.value.status_code == 409
    assert "Archived pending Approval" in str(exc.value.detail)
    db.commit()
    db.refresh(row)
    assert row.status == "Pending"
    assert row.decided_at is None
    assert row.hidden_from_active is True
    assert db.query(models.ActivityLog).count() == 0


def test_active_pending_approval_cannot_decide_archived_request(context):
    db, owner, department = context
    request = models.Request(
        title="Archived source", department_id=department.id,
        status="Review", hidden_from_active=True,
        archived_at=utc_now(), archive_reason="manual_archive",
    )
    db.add(request)
    db.flush()
    approval = models.Approval(
        title="Still visible approval", source_type="ops_need",
        source_id=request.id, department_id=department.id, status="Pending",
    )
    db.add(approval)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        decide_approval(db, owner, approval.id, "Approved")
    assert exc.value.status_code == 409
    assert "Archived linked Request" in str(exc.value.detail)
    db.commit()
    db.refresh(request)
    db.refresh(approval)
    assert request.status == "Review"
    assert request.hidden_from_active is True
    assert approval.status == "Pending"
    assert approval.decided_at is None
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("status", ["New", "Review"])
def test_archived_submission_cannot_receive_new_decision(context, status):
    db, owner, department = context
    submission = models.Submission(
        title="Archived submission", department_id=department.id,
        review_status=status, hidden_from_active=True,
        archived_at=utc_now(), archive_reason="manual_archive",
    )
    db.add(submission)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        decide_submission(db, owner, submission.id, "Accepted")
    assert exc.value.status_code == 409
    assert "Archived Submission" in str(exc.value.detail)
    db.commit()
    db.refresh(submission)
    assert submission.review_status == status
    assert submission.reviewed_by_id is None
    assert submission.reviewed_at is None
    assert submission.hidden_from_active is True
    assert db.query(models.ActivityLog).count() == 0
