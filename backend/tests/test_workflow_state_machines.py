import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.api import StatusPayload
from app.routers.authorized_crud import set_status_authorized, update_resource_authorized
from app.services.approval_workflow import decide_approval
from app.services.external_review_workflow import create_approval, create_task, mark_seen, reject_item
from app.services.fix_workflow import finish_fix, reopen_fix, start_fix, verify_fix
from app.services.request_workflow import complete_request, plan_request, submit_request


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", future=True)
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def seed_users(db):
    dept = models.Department(name="Operations")
    db.add(dept)
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=dept.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=dept.id, is_active=True)
    lead = models.User(name="Lead", role="lead", department_id=dept.id, is_active=True)
    db.add_all([owner, manager, lead])
    db.flush()
    for user in (manager, lead):
        db.add(models.UserDepartment(user_id=user.id, department_id=dept.id, is_primary=True))
    db.commit()
    return dept, owner, manager, lead


def expect_http(status, fn):
    with pytest.raises(HTTPException) as exc:
        fn()
    assert exc.value.status_code == status


def test_request_state_machine_and_generic_status_block(db):
    dept, owner, manager, _ = seed_users(db)
    request = models.Request(title="New freezer", department_id=dept.id, status="Draft", urgency="Normal")
    db.add(request); db.commit()

    expect_http(405, lambda: set_status_authorized("requests", request.id, StatusPayload(status="Approved"), owner, db))
    expect_http(405, lambda: update_resource_authorized("requests", request.id, {"status": "Approved"}, owner, db))

    submitted, approval = submit_request(db, owner, request.id, "Please review")
    assert submitted.status == "Review"
    assert approval.status == "Pending"
    expect_http(409, lambda: submit_request(db, owner, request.id, "again"))

    decided, linked_request, _ = decide_approval(db, manager, approval.id, "Approved", "Approved")
    assert decided.status == "Approved"
    assert linked_request.status == "Approved"

    planned, task = plan_request(db, owner, request.id, "Implement")
    assert planned.status == "Planned"
    assert planned.linked_task_id == task.id
    expect_http(409, lambda: plan_request(db, owner, request.id, "duplicate"))

    completed = complete_request(db, owner, request.id, "Installed")
    assert completed.status == "Done"
    expect_http(409, lambda: complete_request(db, owner, request.id, "again"))


def test_repeated_and_reversed_approval_decisions_are_rejected(db):
    dept, owner, manager, _ = seed_users(db)
    request = models.Request(title="Policy", department_id=dept.id, status="Review")
    db.add(request); db.flush()
    approval = models.Approval(title="Policy", department_id=dept.id, source_type="ops_need", source_id=request.id, status="Pending")
    db.add(approval); db.commit()

    decide_approval(db, manager, approval.id, "Approved", "ok")
    expect_http(409, lambda: decide_approval(db, manager, approval.id, "Approved", "again"))
    expect_http(409, lambda: decide_approval(db, manager, approval.id, "Rejected", "reverse"))


def test_rejection_requires_note_and_is_atomic_with_request(db):
    dept, _, manager, _ = seed_users(db)
    request = models.Request(title="Staffing", department_id=dept.id, status="Review")
    db.add(request); db.flush()
    approval = models.Approval(title="Staffing", department_id=dept.id, source_type="ops_need", source_id=request.id, status="Pending")
    db.add(approval); db.commit()

    expect_http(400, lambda: decide_approval(db, manager, approval.id, "Rejected", ""))
    db.refresh(approval); db.refresh(request)
    assert approval.status == "Pending"
    assert request.status == "Review"

    decide_approval(db, manager, approval.id, "Rejected", "Not now")
    db.refresh(request)
    assert request.status == "Rejected"


def test_fix_state_machine_and_reopen_rules(db):
    dept, owner, manager, lead = seed_users(db)
    fix = models.Fix(title="AC", department_id=dept.id, status="Open")
    db.add(fix); db.commit()

    expect_http(405, lambda: set_status_authorized("fixes", fix.id, StatusPayload(status="Verified"), owner, db))
    expect_http(409, lambda: verify_fix(db, manager, fix.id, "checked"))
    expect_http(409, lambda: finish_fix(db, lead, fix.id, "skip working"))

    assert start_fix(db, lead, fix.id).status == "Working"
    expect_http(409, lambda: start_fix(db, lead, fix.id))
    assert finish_fix(db, lead, fix.id).status == "Done"
    verified = verify_fix(db, manager, fix.id, "tested")
    assert verified.status == "Verified"
    expect_http(409, lambda: start_fix(db, lead, fix.id))
    expect_http(400, lambda: reopen_fix(db, manager, fix.id, ""))
    expect_http(403, lambda: reopen_fix(db, lead, fix.id, "Needs another look"))
    reopened = reopen_fix(db, manager, fix.id, "Needs another look")
    assert reopened.status == "Working"
    assert reopened.verified_by_id is None


def external_item(db, dept_id, suffix="1"):
    row = models.ExternalReviewItem(
        external_source="accounting_program",
        external_id=f"evt-{suffix}",
        event_type="purchase_request.pending",
        source_app="accounting_program",
        department_id=dept_id,
        title="External item",
        status="For Review",
    )
    db.add(row); db.commit()
    return row


def test_external_task_and_approval_creation_are_idempotent(db):
    dept, owner, manager, _ = seed_users(db)
    first = external_item(db, dept.id, "task")
    task1, _ = create_task(db, owner, first.id)
    task2, _ = create_task(db, owner, first.id)
    assert task1.id == task2.id
    assert db.query(models.Task).filter(models.Task.id == task1.id).count() == 1

    second = external_item(db, dept.id, "approval")
    approval1, item = create_approval(db, manager, second.id, note="Review")
    approval2, _ = create_approval(db, manager, second.id, note="Again")
    assert approval1.id == approval2.id
    assert item.status == "Pending Approval"
    assert db.query(models.Approval).filter(models.Approval.id == approval1.id).count() == 1


def test_external_terminal_state_cannot_regress_and_approval_syncs(db):
    dept, _, manager, _ = seed_users(db)
    item = external_item(db, dept.id, "sync")
    approval, _ = create_approval(db, manager, item.id, note="Decide")
    decided, _, external = decide_approval(db, manager, approval.id, "Approved", "Ship it")
    assert decided.status == "Approved"
    assert external.status == "Approved"
    expect_http(409, lambda: mark_seen(db, manager, item.id, "late"))
    expect_http(409, lambda: reject_item(db, manager, item.id, "late reject"))


def test_external_reject_requires_decision_authority_and_reason(db):
    dept, _, manager, lead = seed_users(db)
    item = external_item(db, dept.id, "reject")
    expect_http(400, lambda: reject_item(db, manager, item.id, ""))
    expect_http(403, lambda: reject_item(db, lead, item.id, "No"))
    rejected = reject_item(db, manager, item.id, "No")
    assert rejected.status == "Rejected"


def test_external_pending_approval_cannot_be_rejected_directly(db):
    dept, _, manager, _ = seed_users(db)
    item = external_item(db, dept.id, "pending")
    create_approval(db, manager, item.id, note="Review")
    expect_http(409, lambda: reject_item(db, manager, item.id, "Bypass approval"))
