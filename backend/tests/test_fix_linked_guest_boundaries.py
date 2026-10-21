"""Maintenance verification/reopening must preserve source scope and guest state."""

import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.services.fix_workflow import reopen_fix, verify_fix


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
    maintenance_manager = models.User(
        name="Maintenance manager", role="manager",
        department_id=maintenance.id, is_active=True,
    )
    lead = models.User(name="Front lead", role="lead", department_id=front.id, is_active=True)
    db.add_all([owner, manager, maintenance_manager, lead])
    db.flush()
    for person, dept in ((manager, front), (maintenance_manager, maintenance), (lead, front)):
        db.add(models.UserDepartment(user_id=person.id, department_id=dept.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, manager, maintenance_manager, lead
    finally:
        db.close()
        engine.dispose()


def new_fix(db, department_id, status, guest_department=None, guest_status="Follow"):
    guest = None
    if guest_department is not None:
        guest = models.GuestNote(
            title="Guest aircon issue", department_id=guest_department,
            status=guest_status, note="Aircon not cooling",
        )
        db.add(guest)
        db.flush()
    fix = models.Fix(
        title="Repair aircon", department_id=department_id,
        status=status, linked_guest_note_id=guest.id if guest is not None else None,
    )
    db.add(fix)
    db.flush()
    if guest is not None:
        guest.linked_fix_id = fix.id
    db.commit()
    return fix, guest


def assert_no_mutations(db, fix, guest, expected_fix_status, expected_guest_status=None):
    # Ensure a later commit on the same Session cannot persist denied writes.
    db.commit()
    db.refresh(fix)
    assert fix.status == expected_fix_status
    if guest is not None:
        db.refresh(guest)
        assert guest.status == expected_guest_status
    assert db.query(models.ActivityLog).count() == 0
    assert db.query(models.Comment).count() == 0


@pytest.mark.parametrize("action,status", [("verify", "Done"), ("reopen", "Verified")])
def test_manager_global_read_cannot_mutate_foreign_department_fix(context, action, status):
    db, front, maintenance, _, manager, _, _ = context
    fix, _ = new_fix(db, maintenance.id, status)
    with pytest.raises(HTTPException) as exc:
        if action == "verify":
            verify_fix(db, manager, fix.id, "Tested repair")
        else:
            reopen_fix(db, manager, fix.id, "Problem recurred")
    assert exc.value.status_code == 403
    assert_no_mutations(db, fix, None, status)


@pytest.mark.parametrize("action,fix_status,guest_status", [
    ("verify", "Done", "Follow"),
    ("reopen", "Verified", "Done"),
])
def test_local_fix_cannot_mutate_other_department_guest(context, action, fix_status, guest_status):
    db, front, maintenance, _, manager, _, _ = context
    fix, guest = new_fix(db, front.id, fix_status, maintenance.id, guest_status)
    with pytest.raises(HTTPException) as exc:
        if action == "verify":
            verify_fix(db, manager, fix.id, "Unauthorized resolution")
        else:
            reopen_fix(db, manager, fix.id, "Unauthorized reopening")
    assert exc.value.status_code == 403
    assert_no_mutations(db, fix, guest, fix_status, guest_status)


def test_owner_can_verify_cross_department_fix_and_guest(context):
    db, front, maintenance, owner, _, _, _ = context
    fix, guest = new_fix(db, maintenance.id, "Done", front.id)
    verified = verify_fix(db, owner, fix.id, "Repair verified")
    assert verified.status == "Verified"
    db.refresh(guest)
    assert guest.status == "Done"
    assert guest.completed_at is not None
    assert guest.action_taken == "Repair verified"
    assert db.query(models.Comment).count() == 1


def test_manager_dual_membership_can_verify_and_reopen_cross_department_guest(context):
    db, front, maintenance, _, manager, _, _ = context
    db.add(models.UserDepartment(user_id=manager.id, department_id=maintenance.id, is_primary=False))
    db.commit()
    fix, guest = new_fix(db, front.id, "Done", maintenance.id)
    assert verify_fix(db, manager, fix.id, "Confirmed").status == "Verified"
    assert reopen_fix(db, manager, fix.id, "Issue returned").status == "Working"
    db.refresh(guest)
    assert guest.status == "Follow"
    assert guest.completed_at is None


def test_reopening_archived_fix_restores_archived_guest_to_active_queue(context):
    db, front, _, owner, _, _, _ = context
    fix, guest = new_fix(db, front.id, "Done", front.id)
    verify_fix(db, owner, fix.id, "Verified AC")
    archived_at = utc_now()
    fix.hidden_from_active = True
    fix.archived_at = archived_at
    fix.archive_reason = "verified_24h"
    guest.hidden_from_active = True
    guest.archived_at = archived_at
    guest.archive_reason = "done_24h"
    db.commit()

    reopened = reopen_fix(db, owner, fix.id, "Guest reported same issue")
    db.refresh(guest)
    assert reopened.status == "Working"
    assert reopened.hidden_from_active is False
    assert reopened.archived_at is None
    assert reopened.completed_at is None
    assert guest.status == "Follow"
    assert guest.hidden_from_active is False
    assert guest.archived_at is None
    assert guest.archive_reason is None
    assert guest.completed_at is None
    activity = db.query(models.ActivityLog).filter_by(
        entity_type="guests", entity_id=guest.id, action="reopened"
    ).one()
    metadata = json.loads(activity.metadata_json)
    assert metadata["previous_archive_reason"] == "done_24h"


@pytest.mark.parametrize("action,status,guest_status", [
    ("verify", "Done", "Follow"),
    ("reopen", "Verified", "Done"),
])
def test_broken_reverse_link_blocks_linked_guest_mutation(context, action, status, guest_status):
    db, front, _, owner, _, _, _ = context
    fix, guest = new_fix(db, front.id, status, front.id, guest_status)
    another = models.Fix(title="Another fix", department_id=front.id, status="Open")
    db.add(another)
    db.flush()
    guest.linked_fix_id = another.id
    db.commit()
    with pytest.raises(HTTPException) as exc:
        if action == "verify":
            verify_fix(db, owner, fix.id, "Cannot apply")
        else:
            reopen_fix(db, owner, fix.id, "Cannot reopen")
    assert exc.value.status_code == 409
    assert_no_mutations(db, fix, guest, status, guest_status)


def test_missing_guest_blocks_verification_without_partial_state(context):
    db, front, _, owner, _, _, _ = context
    fix, _ = new_fix(db, front.id, "Done")
    fix.linked_guest_note_id = 99009
    db.commit()
    with pytest.raises(HTTPException) as exc:
        verify_fix(db, owner, fix.id, "Cannot resolve nonexistent guest")
    assert exc.value.status_code == 409
    assert_no_mutations(db, fix, None, "Done")


def test_already_resolved_guest_cannot_be_silently_overwritten(context):
    db, front, _, owner, _, _, _ = context
    fix, guest = new_fix(db, front.id, "Done", front.id, guest_status="Done")
    guest.action_taken = "Already resolved independently"
    db.commit()
    with pytest.raises(HTTPException) as exc:
        verify_fix(db, owner, fix.id, "Overwrite")
    assert exc.value.status_code == 409
    assert_no_mutations(db, fix, guest, "Done", "Done")
    db.refresh(guest)
    assert guest.action_taken == "Already resolved independently"


def test_invalid_proof_cannot_partially_verify_or_create_comment(context):
    db, front, _, owner, _, _, _ = context
    fix, guest = new_fix(db, front.id, "Done", front.id)
    unrelated = models.Attachment(
        parent_type="fixes", parent_id=fix.id + 100,
        filename="Not this fix", file_url="/proof.png",
    )
    db.add(unrelated)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        verify_fix(
            db, owner, fix.id, "Tested",
            proof_url=f"/api/attachments/{unrelated.id}/download",
        )
    assert exc.value.status_code == 400
    assert_no_mutations(db, fix, guest, "Done", "Follow")


def test_decision_capability_required_even_with_department_access(context):
    db, front, _, _, _, _, lead = context
    fix, guest = new_fix(db, front.id, "Done", front.id)
    with pytest.raises(HTTPException) as exc:
        verify_fix(db, lead, fix.id, "Attempt")
    assert exc.value.status_code == 403
    assert_no_mutations(db, fix, guest, "Done", "Follow")
