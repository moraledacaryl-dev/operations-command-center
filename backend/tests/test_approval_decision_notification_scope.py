"""Approval decision notices must respect recipient's current read permissions."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app import foundation_models as foundation
from app.services.approval_workflow import decide_approval


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front = models.Department(name="Front Desk")
    kitchen = models.Department(name="Kitchen")
    db.add_all([front, kitchen])
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    staff = models.User(name="Front staff", role="staff", department_id=front.id, is_active=True)
    outsider = models.User(name="Kitchen staff", role="staff", department_id=kitchen.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=kitchen.id, is_active=True)
    inactive = models.User(name="Former staff", role="staff", department_id=front.id, is_active=False)
    db.add_all([owner, staff, outsider, manager, inactive])
    db.flush()
    for person, department in ((staff, front), (outsider, kitchen), (manager, kitchen), (inactive, front)):
        db.add(models.UserDepartment(user_id=person.id, department_id=department.id, is_primary=True))
    db.commit()
    try:
        yield db, front, kitchen, owner, staff, outsider, manager, inactive
    finally:
        db.close()
        engine.dispose()


def create_approval(db, department, requester=None):
    approval = models.Approval(
        title="Confidential purchase approval",
        status="Pending",
        department_id=department.id,
        requested_by_id=requester.id if requester else None,
    )
    db.add(approval)
    db.commit()
    return approval


def notifications(db):
    return db.query(foundation.Notification).all()


@pytest.mark.parametrize("requester_kind", ["foreign", "inactive", "unknown"])
def test_decision_remains_valid_but_does_not_notify_inaccessible_requester(context, requester_kind):
    db, front, _, owner, _, foreign, _, inactive = context
    requester = {"foreign": foreign, "inactive": inactive, "unknown": None}[requester_kind]
    approval = create_approval(db, front, requester)
    if requester_kind == "unknown":
        approval.requested_by_id = None
        db.commit()
    decided, request, item = decide_approval(
        db, owner, approval.id, "Rejected", "Sensitive payroll and purchase details"
    )
    assert decided.status == "Rejected"
    assert decided.decided_by_id == owner.id
    assert decided.decision_note == "Sensitive payroll and purchase details"
    assert request is None and item is None
    assert notifications(db) == []


def test_same_department_requester_receives_one_decision_notice(context):
    db, front, _, owner, staff, _, _, _ = context
    approval = create_approval(db, front, staff)
    decided, _, _ = decide_approval(db, owner, approval.id, "Approved", "Approved after review")
    assert decided.status == "Approved"
    notices = notifications(db)
    assert len(notices) == 1
    assert notices[0].user_id == staff.id
    assert "Confidential purchase approval" in notices[0].title
    assert "Approved after review" in notices[0].body
    assert notices[0].source_id == str(approval.id)


def test_secondary_department_membership_permits_notification(context):
    db, front, _, owner, _, foreign, _, _ = context
    db.add(models.UserDepartment(
        user_id=foreign.id, department_id=front.id, is_primary=False,
    ))
    db.commit()
    approval = create_approval(db, front, foreign)
    decide_approval(db, owner, approval.id, "Approved", "Both departments")
    assert {item.user_id for item in notifications(db)} == {foreign.id}


def test_revoked_department_membership_prevents_notification(context):
    db, front, _, owner, _, foreign, _, _ = context
    membership = models.UserDepartment(
        user_id=foreign.id, department_id=front.id, is_primary=False,
    )
    db.add(membership)
    db.commit()
    approval = create_approval(db, front, foreign)
    db.delete(membership)
    db.commit()
    decide_approval(db, owner, approval.id, "Approved", "Private discussion")
    assert notifications(db) == []


def test_manager_with_explicit_global_read_can_receive_cross_department_decision(context):
    db, front, _, owner, _, _, manager, _ = context
    approval = create_approval(db, front, manager)
    decide_approval(db, owner, approval.id, "Approved", "Management decision")
    assert {item.user_id for item in notifications(db)} == {manager.id}


def test_denying_notification_does_not_undo_linked_request_decision(context):
    db, front, _, owner, _, outsider, _, _ = context
    request = models.Request(title="Private front-office supply", department_id=front.id, status="Review")
    db.add(request)
    db.flush()
    approval = models.Approval(
        title="Private request", status="Pending", department_id=front.id,
        requested_by_id=outsider.id, source_type="ops_need", source_id=request.id,
    )
    db.add(approval)
    db.commit()
    decided, linked, _ = decide_approval(db, owner, approval.id, "Approved", "For front office")
    assert decided.status == "Approved"
    assert linked.id == request.id
    assert linked.status == "Approved"
    assert notifications(db) == []
    assert db.query(models.ActivityLog).filter_by(entity_type="requests", action="decision").count() == 1
