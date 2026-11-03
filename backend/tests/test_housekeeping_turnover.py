"""Manual checkout verification and independent housekeeping inspection."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.routers.housekeeping import (
    PlanRequest, TickRequest, InspectionRequest,
    list_turnovers, plan_turnover, confirm_vacated, start, tick, submit, inspect,
    ITEMS,
)


@pytest.fixture
def state(monkeypatch):
    from datetime import datetime, timezone
    monkeypatch.setattr("app.routers.housekeeping.utc_now", lambda: datetime(2026, 11, 6, tzinfo=timezone.utc))
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, future=True)()
    front = models.Department(name="Front Desk")
    housekeeping = models.Department(name="Housekeeping")
    kitchen = models.Department(name="Kitchen")
    db.add_all([front, housekeeping, kitchen])
    db.flush()
    people = {
        "front": models.User(name="Reception", role="staff", department_id=front.id, is_active=True),
        "cleaner": models.User(name="Cleaner", role="staff", department_id=housekeeping.id, is_active=True),
        "second_cleaner": models.User(name="Other cleaner", role="staff", department_id=housekeeping.id, is_active=True),
        "lead": models.User(name="Housekeeping Lead", role="lead", department_id=housekeeping.id, is_active=True),
        "outsider": models.User(name="Cook", role="staff", department_id=kitchen.id, is_active=True),
    }
    room = models.RoomArea(name="Solace", kind="room")
    db.add_all([*people.values(), room])
    db.commit()
    try:
        yield db, people, room
    finally:
        db.close()
        engine.dispose()


def test_cleaning_requires_verified_departure_all_steps_and_separate_inspection(state):
    db, p, room = state
    data = list_turnovers(service_date="2026-11-04", user=p["cleaner"], db=db)
    assert data["rooms"][0]["status"] == "No cleaning request"
    assert data["can_schedule"] is False and data["can_clean"] is True
    with pytest.raises(HTTPException) as err:
        plan_turnover(PlanRequest(room_area_id=room.id, service_date="2026-11-04"),
                      user=p["cleaner"], db=db)
    assert err.value.status_code == 403

    created = plan_turnover(PlanRequest(room_area_id=room.id, service_date="2026-11-04"),
                            user=p["front"], db=db)
    turn_id = created["id"]
    assert not created["vacated_confirmed"]
    with pytest.raises(HTTPException) as err:
        start(turn_id, user=p["cleaner"], db=db)
    assert err.value.status_code == 409

    confirm_vacated(turn_id, user=p["front"], db=db)
    started = start(turn_id, user=p["cleaner"], db=db)
    assert started["status"] == "Cleaning"
    with pytest.raises(HTTPException) as err:
        tick(turn_id, "linen", TickRequest(checked=True), user=p["second_cleaner"], db=db)
    assert err.value.status_code == 403
    with pytest.raises(HTTPException) as err:
        submit(turn_id, user=p["cleaner"], db=db)
    assert err.value.status_code == 409
    for key, _ in ITEMS:
        tick(turn_id, key, TickRequest(checked=True), user=p["cleaner"], db=db)
    pending = submit(turn_id, user=p["cleaner"], db=db)
    assert pending["status"] == "For inspection"

    with pytest.raises(HTTPException) as err:
        inspect(turn_id, InspectionRequest(cleared=True), user=p["cleaner"], db=db)
    assert err.value.status_code == 403
    cleared = inspect(turn_id, InspectionRequest(cleared=True), user=p["lead"], db=db)
    assert cleared["status"] == "Cleared"
    assert cleared["inspected_by_id"] == p["lead"].id
    assert db.get(models.RoomArea, room.id).status == "active"  # PMS not touched


def test_failed_inspection_forces_rework_and_does_not_mark_room_ready(state):
    db, p, room = state
    turn_id = plan_turnover(PlanRequest(room_area_id=room.id, service_date="2026-11-05"),
                            user=p["front"], db=db)["id"]
    confirm_vacated(turn_id, user=p["front"], db=db)
    start(turn_id, user=p["cleaner"], db=db)
    for key, _ in ITEMS:
        tick(turn_id, key, TickRequest(checked=True), user=p["cleaner"], db=db)
    submit(turn_id, user=p["cleaner"], db=db)
    result = inspect(turn_id, InspectionRequest(cleared=False, note="Mirror needs cleaning"),
                     user=p["lead"], db=db)
    assert result["status"] == "Needs rework"
    assert not any(item["checked"] for item in result["checklist"])
    assert db.get(models.RoomArea, room.id).status == "active"


def test_housekeeping_access_is_scoped_to_correct_department(state):
    db, p, room = state
    with pytest.raises(HTTPException) as err:
        list_turnovers(service_date="2026-11-05", user=p["outsider"], db=db)
    assert err.value.status_code == 403
    with pytest.raises(HTTPException) as err:
        confirm_vacated(10, user=p["outsider"], db=db)
    assert err.value.status_code == 403


def test_board_includes_stays_spanning_today_without_inventing_historical_status(state):
    import json
    from datetime import datetime, timezone
    from app.integration_models import AccountingRoomBooking
    db, people, room = state
    db.add(AccountingRoomBooking(
        booking_id="practice-stay", revision=1, room_ids_json=json.dumps([room.id]),
        check_in="2026-11-04", check_out="2026-11-08", status="checked_in",
        origin="practice", reported_at=datetime(2026, 11, 6, tzinfo=timezone.utc),
    ))
    db.commit()
    today = list_turnovers(service_date="2026-11-06", user=people["front"], db=db)
    assert [item["status"] for item in today["rooms"][0]["booking_updates"]] == ["checked_in"]
    for day in ("2026-11-05", "2026-11-07"):
        board = list_turnovers(service_date=day, user=people["front"], db=db)
        assert board["rooms"][0]["booking_updates"] == []


def test_unresolved_checkin_is_visible_after_scheduled_departure(state):
    import json
    from datetime import datetime, timezone
    from app.integration_models import AccountingRoomBooking
    db, people, room = state
    db.add(AccountingRoomBooking(
        booking_id="practice-late-departure", revision=1, room_ids_json=json.dumps([room.id]),
        check_in="2026-11-01", check_out="2026-11-05", status="checked_in",
        origin="practice", reported_at=datetime(2026, 11, 5, tzinfo=timezone.utc),
    ))
    db.commit()
    board = list_turnovers(service_date="2026-11-06", user=people["front"], db=db)
    assert board["rooms"][0]["booking_updates"][0]["status"] == "checked_in"
