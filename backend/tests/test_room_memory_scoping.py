"""Room Memory must enforce departmental read scope before its 50-record limit."""

from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.routers.api import room_memory


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    front = models.Department(name="Front Desk")
    maintenance = models.Department(name="Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    staff = models.User(
        name="Front desk staff", email="room-memory-staff@example.com",
        role="staff", department_id=front.id, is_active=True,
    )
    owner = models.User(
        name="Owner", email="room-memory-owner@example.com",
        role="owner", department_id=front.id, is_active=True,
    )
    unassigned = models.User(
        name="Unassigned", email="room-memory-unassigned@example.com",
        role="staff", department_id=None, is_active=True,
    )
    room = models.RoomArea(name="Room 101", kind="room")
    db.add_all([staff, owner, unassigned, room])
    db.commit()
    try:
        yield db, front, maintenance, staff, owner, unassigned, room
    finally:
        db.close()
        engine.dispose()


def _seed_room_records(db, room, front, maintenance):
    now = utc_now()
    # Records outside this staff member's department consume the original
    # 50-row limit, making older authorized records disappear.
    for index in range(55):
        timestamp = now - timedelta(minutes=index)
        db.add(models.GuestNote(
            title=f"Maintenance guest {index}", room_area_id=room.id,
            department_id=maintenance.id, updated_at=timestamp,
        ))
        db.add(models.Fix(
            title=f"Maintenance fix {index}", room_area_id=room.id,
            department_id=maintenance.id, updated_at=timestamp,
        ))
    for index in range(3):
        timestamp = now - timedelta(days=index + 1)
        db.add(models.GuestNote(
            title=f"Front guest {index}", room_area_id=room.id,
            department_id=front.id, updated_at=timestamp,
        ))
        db.add(models.Fix(
            title=f"Front fix {index}", room_area_id=room.id,
            department_id=front.id, updated_at=timestamp,
        ))
    db.add(models.GuestNote(
        title="Unassigned guest private note", room_area_id=room.id,
        department_id=None, updated_at=now + timedelta(minutes=1),
    ))
    db.add(models.Fix(
        title="Unassigned fix private note", room_area_id=room.id,
        department_id=None, updated_at=now + timedelta(minutes=1),
    ))
    db.commit()


def test_staff_sees_all_authorized_room_notes_even_after_fifty_newer_foreign_rows(context):
    db, front, maintenance, staff, _, _, room = context
    _seed_room_records(db, room, front, maintenance)

    result = room_memory(room_id=room.id, user=staff, db=db)
    assert result["room"]["id"] == room.id
    assert [row["title"] for row in result["guests"]] == [
        "Front guest 0", "Front guest 1", "Front guest 2",
    ]
    assert [row["title"] for row in result["fixes"]] == [
        "Front fix 0", "Front fix 1", "Front fix 2",
    ]


def test_owner_keeps_all_department_visibility_with_fifty_row_cap(context):
    db, front, maintenance, _, owner, _, room = context
    _seed_room_records(db, room, front, maintenance)

    result = room_memory(room_id=room.id, user=owner, db=db)
    assert len(result["guests"]) == 50
    assert len(result["fixes"]) == 50
    assert result["guests"][0]["title"] == "Unassigned guest private note"
    assert result["fixes"][0]["title"] == "Unassigned fix private note"


def test_user_without_department_sees_no_guest_or_fix_records(context):
    db, front, maintenance, _, _, unassigned, room = context
    _seed_room_records(db, room, front, maintenance)

    result = room_memory(room_id=room.id, user=unassigned, db=db)
    assert result["guests"] == []
    assert result["fixes"] == []


def test_staff_additional_department_membership_is_respected(context):
    db, front, maintenance, staff, _, _, room = context
    _seed_room_records(db, room, front, maintenance)
    db.add(models.UserDepartment(
        user_id=staff.id, department_id=maintenance.id, is_primary=False,
    ))
    db.commit()

    result = room_memory(room_id=room.id, user=staff, db=db)
    # The latest 50 assigned records are now visible, but unassigned
    # records are never included for a nonexecutive account.
    assert len(result["guests"]) == 50
    assert len(result["fixes"]) == 50
    assert result["guests"][0]["title"] == "Maintenance guest 0"
    assert result["fixes"][0]["title"] == "Maintenance fix 0"
    assert all(row["department_id"] is not None for row in result["guests"])
    assert all(row["department_id"] is not None for row in result["fixes"])
