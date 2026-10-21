"""Generic CRUD must not bypass canonical Guest-to-Fix identity constraints."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.authorized_crud import create_resource_authorized, update_resource_authorized
from app.services.guest_workflow import create_fix_from_guest


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    department = models.Department(name="Front Desk")
    db.add(department)
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=department.id, is_active=True)
    lead = models.User(name="Lead", role="lead", department_id=department.id, is_active=True)
    db.add_all([owner, lead])
    db.flush()
    db.add(models.UserDepartment(user_id=lead.id, department_id=department.id, is_primary=True))
    db.commit()
    try:
        yield db, department, owner, lead
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize("resource,field", [
    ("guests", "linked_fix_id"),
    ("fixes", "linked_guest_note_id"),
])
@pytest.mark.parametrize("value", [None, 777])
@pytest.mark.parametrize("actor", ["owner", "lead"])
def test_generic_create_cannot_set_workflow_owned_link_even_null(context, resource, field, value, actor):
    db, department, owner, lead = context
    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(
            resource,
            {"title": "Unauthorized direct link", "department_id": department.id, field: value},
            user=owner if actor == "owner" else lead,
            db=db,
        )
    assert exc.value.status_code == 405
    assert field in exc.value.detail
    db.commit()
    assert db.query(models.GuestNote).count() == 0
    assert db.query(models.Fix).count() == 0
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("resource,field", [
    ("guests", "linked_fix_id"),
    ("fixes", "linked_guest_note_id"),
])
@pytest.mark.parametrize("value", [None, 999])
@pytest.mark.parametrize("actor", ["owner", "lead"])
def test_generic_patch_cannot_forge_or_clear_links(context, resource, field, value, actor):
    db, department, owner, lead = context
    model = models.GuestNote if resource == "guests" else models.Fix
    row = model(title="Untouched", department_id=department.id)
    db.add(row)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            resource, row.id,
            {"title": "Forged edit", field: value},
            user=owner if actor == "owner" else lead,
            db=db,
        )
    assert exc.value.status_code == 405
    db.commit()
    db.refresh(row)
    assert row.title == "Untouched"
    assert getattr(row, field) is None
    assert db.query(models.ActivityLog).count() == 0


def test_generic_create_and_edit_still_allow_normal_unlinked_records(context):
    db, department, owner, lead = context
    guest = create_resource_authorized(
        "guests",
        {"title": "Pool complaint", "department_id": department.id},
        user=lead, db=db,
    )
    fix = create_resource_authorized(
        "fixes",
        {"title": "Repair pool light", "department_id": department.id},
        user=lead, db=db,
    )
    updated = update_resource_authorized(
        "guests", guest["id"], {"title": "Pool water complaint"}, user=lead, db=db,
    )
    assert updated["title"] == "Pool water complaint"
    assert fix["linked_guest_note_id"] is None


def test_canonical_guest_create_fix_still_writes_both_links_atomically(context):
    db, department, owner, _ = context
    guest = models.GuestNote(title="Leaking faucet", department_id=department.id, status="Open")
    db.add(guest)
    db.commit()
    result_guest, fix = create_fix_from_guest(db, owner, guest.id)
    assert result_guest.linked_fix_id == fix.id
    assert fix.linked_guest_note_id == guest.id
    assert result_guest.status == "Follow"
    assert db.query(models.Fix).count() == 1
    retry_guest, retry_fix = create_fix_from_guest(db, owner, guest.id)
    assert retry_fix.id == fix.id
    assert retry_guest.linked_fix_id == fix.id
    assert db.query(models.Fix).count() == 1


def test_restricted_patch_does_not_change_existing_canonical_relationship(context):
    db, department, owner, _ = context
    guest = models.GuestNote(title="Broken lock", department_id=department.id)
    db.add(guest)
    db.commit()
    linked_guest, fix = create_fix_from_guest(db, owner, guest.id)
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            "fixes", fix.id, {"linked_guest_note_id": None}, user=owner, db=db,
        )
    assert exc.value.status_code == 405
    db.commit()
    db.refresh(fix)
    db.refresh(linked_guest)
    assert fix.linked_guest_note_id == linked_guest.id
    assert linked_guest.linked_fix_id == fix.id
