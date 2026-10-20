"""Guest-to-Fix generation must be idempotent and preserve resolved matters."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.guest_workflow import create_fix_from_guest


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
    lead = models.User(name="Front Desk lead", role="lead", department_id=front.id, is_active=True)
    other_lead = models.User(name="Maintenance lead", role="lead", department_id=maintenance.id, is_active=True)
    db.add_all([owner, lead, other_lead])
    db.flush()
    guest = models.GuestNote(
        title="Broken room lock", department_id=front.id, status="Open",
        note="Door lock sticks when closing",
    )
    db.add(guest)
    db.commit()
    try:
        yield db, front, maintenance, owner, lead, other_lead, guest
    finally:
        db.close()
        engine.dispose()


def test_repeated_fix_generation_reuses_ticket_and_does_not_duplicate_audit(context):
    db, front, _, owner, _, _, guest = context
    returned, fix = create_fix_from_guest(db, owner, guest.id)
    assert returned.status == "Follow"
    assert returned.linked_fix_id == fix.id
    assert fix.linked_guest_note_id == guest.id
    assert fix.department_id == front.id
    assert fix.problem == "Door lock sticks when closing"

    first_count = db.query(models.ActivityLog).count()
    same_guest, same_fix = create_fix_from_guest(db, owner, guest.id, note="Retry should be ignored")
    assert same_fix.id == fix.id
    assert same_guest.linked_fix_id == fix.id
    assert db.query(models.Fix).count() == 1
    assert db.query(models.ActivityLog).count() == first_count


def test_legacy_fix_reverse_link_is_recovered_without_new_ticket(context):
    db, _, _, owner, _, _, guest = context
    previous = models.Fix(
        title="Existing maintenance Fix", department_id=guest.department_id,
        linked_guest_note_id=guest.id, status="Working",
    )
    guest.status = "Follow"
    db.add(previous)
    db.commit()
    assert guest.linked_fix_id is None

    returned, same_fix = create_fix_from_guest(db, owner, guest.id)
    assert returned.linked_fix_id == previous.id
    assert same_fix.id == previous.id
    assert same_fix.status == "Working"
    assert db.query(models.Fix).count() == 1


@pytest.mark.parametrize("status,hidden", [
    ("Done", False), ("Done", True), ("Open", True),
])
def test_completed_or_archived_guest_cannot_be_reset_to_follow(context, status, hidden):
    db, _, _, owner, _, _, guest = context
    guest.status = status
    guest.hidden_from_active = hidden
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_fix_from_guest(db, owner, guest.id)
    assert exc.value.status_code == 409
    db.refresh(guest)
    assert guest.status == status
    assert guest.hidden_from_active is hidden
    assert db.query(models.Fix).count() == 0


def test_inconsistent_guest_fix_link_never_creates_replacement(context):
    db, _, _, owner, _, _, guest = context
    unrelated = models.Fix(title="Unrelated", department_id=guest.department_id)
    db.add(unrelated)
    db.flush()
    guest.linked_fix_id = unrelated.id
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_fix_from_guest(db, owner, guest.id)
    assert exc.value.status_code == 409
    assert db.query(models.Fix).count() == 1


def test_retry_cannot_change_linked_fix_department(context):
    db, front, maintenance, owner, _, _, guest = context
    _, fix = create_fix_from_guest(db, owner, guest.id)
    with pytest.raises(HTTPException) as exc:
        create_fix_from_guest(db, owner, guest.id, department_id=maintenance.id)
    assert exc.value.status_code == 409
    db.refresh(guest)
    assert guest.linked_fix_id == fix.id
    assert db.query(models.Fix).count() == 1


def test_unrelated_department_cannot_create_or_read_guest_ticket(context):
    db, _, _, _, _, maintenance_lead, guest = context
    with pytest.raises(HTTPException) as exc:
        create_fix_from_guest(db, maintenance_lead, guest.id)
    assert exc.value.status_code == 403
    assert db.query(models.Fix).count() == 0


def test_lead_cannot_use_retry_to_read_cross_department_fix(context):
    db, front, maintenance, owner, lead, _, guest = context
    _, fix = create_fix_from_guest(db, owner, guest.id, department_id=maintenance.id)
    assert fix.department_id == maintenance.id
    with pytest.raises(HTTPException) as exc:
        create_fix_from_guest(db, lead, guest.id)
    assert exc.value.status_code == 403
    assert db.query(models.Fix).count() == 1


def test_fix_can_be_created_after_explicit_guest_reopen(context):
    db, _, _, owner, _, _, guest = context
    guest.status = "Done"
    db.commit()
    with pytest.raises(HTTPException):
        create_fix_from_guest(db, owner, guest.id)

    guest.status = "Follow"
    db.commit()
    returned, fix = create_fix_from_guest(db, owner, guest.id)
    assert returned.linked_fix_id == fix.id
    assert returned.status == "Follow"
    assert db.query(models.Fix).count() == 1
