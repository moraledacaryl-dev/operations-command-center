"""Approval decisions must not mutate foreign, stale, or incorrectly linked sources."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.approval_workflow import decide_approval


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
    manager = models.User(name="Manager", role="manager", department_id=front.id, is_active=True)
    db.add_all([owner, manager])
    db.flush()
    db.add(models.UserDepartment(user_id=manager.id, department_id=front.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, manager
    finally:
        db.close()
        engine.dispose()


def request_approval(db, approval_department, request_department):
    request = models.Request(title="New supplies", department_id=request_department, status="Review")
    db.add(request)
    db.flush()
    approval = models.Approval(
        title="Purchase supplies", department_id=approval_department,
        status="Pending", source_type="ops_need", source_id=request.id,
    )
    db.add(approval)
    db.commit()
    return request, approval


def external_approval(db, approval_department, item_department):
    item = models.ExternalReviewItem(
        external_source="accounting_program",
        external_id=f"approval-source-{approval_department}-{item_department}",
        source_app="accounting_program",
        event_type="approval.pending", title="Review purchase",
        department_id=item_department, status="Pending Approval",
    )
    db.add(item)
    db.flush()
    approval = models.Approval(
        title="Review purchase", department_id=approval_department,
        status="Pending", source_type="external_review_item", source_id=item.id,
    )
    db.add(approval)
    db.flush()
    item.linked_approval_id = approval.id
    db.commit()
    return item, approval


def assert_decision_untouched_after_failed_request(db, approval):
    # In a reused Session, even an unrelated later commit must not persist
    # a partially authorized decision.
    db.commit()
    db.refresh(approval)
    assert approval.status == "Pending"
    assert approval.decided_by_id is None
    assert approval.decided_at is None
    assert approval.completed_at is None
    assert db.query(models.ActivityLog).count() == 0


def test_manager_cannot_decide_approval_that_changes_foreign_request(context):
    db, front, maintenance, _, manager = context
    request, approval = request_approval(db, front.id, maintenance.id)
    with pytest.raises(HTTPException) as exc:
        decide_approval(db, manager, approval.id, "Approved", "Attempt")
    assert exc.value.status_code == 403
    assert_decision_untouched_after_failed_request(db, approval)
    db.refresh(request)
    assert request.status == "Review"
    assert request.decision is None


def test_manager_cannot_decide_approval_that_changes_foreign_external_item(context):
    db, front, maintenance, _, manager = context
    item, approval = external_approval(db, front.id, maintenance.id)
    with pytest.raises(HTTPException) as exc:
        decide_approval(db, manager, approval.id, "Rejected", "Attempt")
    assert exc.value.status_code == 403
    assert_decision_untouched_after_failed_request(db, approval)
    db.refresh(item)
    assert item.status == "Pending Approval"
    assert item.summary is None


def test_owner_can_decide_cross_department_sources(context):
    db, front, maintenance, owner, _ = context
    request, req_approval = request_approval(db, front.id, maintenance.id)
    approved, linked_request, _ = decide_approval(db, owner, req_approval.id, "Approved", "Approved")
    assert approved.status == "Approved"
    assert linked_request.id == request.id
    assert linked_request.status == "Approved"

    item, external = external_approval(db, front.id, maintenance.id)
    rejected, _, linked_item = decide_approval(db, owner, external.id, "Rejected", "Out of scope")
    assert rejected.status == "Rejected"
    assert linked_item.id == item.id
    assert linked_item.status == "Rejected"
    assert "Decision: Out of scope" in linked_item.summary


def test_manager_can_decide_linked_request_with_second_department_membership(context):
    db, front, maintenance, _, manager = context
    db.add(models.UserDepartment(
        user_id=manager.id, department_id=maintenance.id, is_primary=False,
    ))
    db.commit()
    request, approval = request_approval(db, front.id, maintenance.id)
    decided, linked, _ = decide_approval(db, manager, approval.id, "Approved", "Both departments")
    assert decided.status == "Approved"
    assert linked.id == request.id
    assert linked.status == "Approved"


def test_manager_can_decide_linked_external_item_with_second_membership(context):
    db, front, maintenance, _, manager = context
    db.add(models.UserDepartment(
        user_id=manager.id, department_id=maintenance.id, is_primary=False,
    ))
    db.commit()
    item, approval = external_approval(db, front.id, maintenance.id)
    decided, _, linked = decide_approval(db, manager, approval.id, "Approved", "Approved")
    assert decided.status == "Approved"
    assert linked.id == item.id
    assert linked.status == "Approved"


def test_external_item_no_longer_pending_cannot_be_overwritten(context):
    db, front, _, owner, _ = context
    item, approval = external_approval(db, front.id, front.id)
    item.status = "Rejected"
    db.commit()
    with pytest.raises(HTTPException) as exc:
        decide_approval(db, owner, approval.id, "Approved", "Stale request")
    assert exc.value.status_code == 409
    assert_decision_untouched_after_failed_request(db, approval)
    db.refresh(item)
    assert item.status == "Rejected"


def test_mismatched_reverse_link_cannot_decide_wrong_external_item(context):
    db, front, _, owner, _ = context
    item, approval = external_approval(db, front.id, front.id)
    unrelated = models.Approval(title="Unrelated", department_id=front.id, status="Pending")
    db.add(unrelated)
    db.flush()
    item.linked_approval_id = unrelated.id
    db.commit()
    with pytest.raises(HTTPException) as exc:
        decide_approval(db, owner, approval.id, "Approved", "Mismatched")
    assert exc.value.status_code == 409
    assert_decision_untouched_after_failed_request(db, approval)
    db.refresh(item)
    assert item.status == "Pending Approval"


def test_normal_scoped_request_decision_still_succeeds(context):
    db, front, _, _, manager = context
    request, approval = request_approval(db, front.id, front.id)
    decided, linked, _ = decide_approval(db, manager, approval.id, "Rejected", "Not necessary")
    assert decided.status == "Rejected"
    assert linked.id == request.id
    assert linked.status == "Rejected"
