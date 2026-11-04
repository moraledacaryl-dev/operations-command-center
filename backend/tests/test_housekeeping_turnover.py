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


def test_front_desk_records_stays_and_guest_blocks_cleaning(state):
    from app.routers.housekeeping import check_in, check_out
    db, people, room = state
    turnover = plan_turnover(PlanRequest(room_area_id=room.id, service_date='2026-11-06'), user=people['front'], db=db)
    confirm_vacated(turnover['id'], user=people['front'], db=db)
    with pytest.raises(HTTPException) as error:
        check_in(room.id, user=people['cleaner'], db=db)
    assert error.value.status_code == 403
    stay = check_in(room.id, user=people['front'], db=db)
    board = list_turnovers(service_date='2026-11-06', user=people['cleaner'], db=db)
    assert board['rooms'][0]['guest_stay']['id'] == stay['id']
    assert board['rooms'][0]['vacated_confirmed'] is False
    for action in (lambda: check_in(room.id, user=people['front'], db=db),
                   lambda: confirm_vacated(turnover['id'], user=people['front'], db=db),
                   lambda: start(turnover['id'], user=people['cleaner'], db=db)):
        with pytest.raises(HTTPException) as error:
            action()
        assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        check_out(room.id, stay['id'], user=people['cleaner'], db=db)
    assert error.value.status_code == 403
    assert check_out(room.id, stay['id'], user=people['front'], db=db)['checked_out_at']
    with pytest.raises(HTTPException) as error:
        check_out(room.id, stay['id'], user=people['front'], db=db)
    assert error.value.status_code == 409
    confirm_vacated(turnover['id'], user=people['front'], db=db)
    assert start(turnover['id'], user=people['cleaner'], db=db)['status'] == 'Cleaning'
    assert list_turnovers(service_date='2026-11-05', user=people['front'], db=db)['rooms'][0]['guest_stay'] is None


def test_only_one_active_stay_is_allowed_by_database(state):
    from sqlalchemy.exc import IntegrityError
    db, people, room = state
    db.add_all([models.RoomStay(room_area_id=room.id, checked_in_by_id=people['front'].id),
                models.RoomStay(room_area_id=room.id, checked_in_by_id=people['front'].id)])
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_new_checkin_invalidates_cleaning_already_in_progress(state):
    from app.routers.housekeeping import check_in, check_out
    db, people, room = state
    turnover = plan_turnover(PlanRequest(room_area_id=room.id, service_date='2026-11-06'), user=people['front'], db=db)
    confirm_vacated(turnover['id'], user=people['front'], db=db)
    start(turnover['id'], user=people['cleaner'], db=db)
    stay = check_in(room.id, user=people['front'], db=db)
    check_out(room.id, stay['id'], user=people['front'], db=db)
    with pytest.raises(HTTPException) as error:
        tick(turnover['id'], 'linen', TickRequest(checked=True), user=people['cleaner'], db=db)
    assert error.value.status_code == 409


def test_second_guest_gets_a_new_cleaning_record(state, monkeypatch):
    from datetime import datetime, timezone, timedelta
    from app.routers.housekeeping import check_in, check_out
    db, people, room = state
    time = datetime(2026, 11, 6, tzinfo=timezone.utc)
    monkeypatch.setattr('app.routers.housekeeping.utc_now', lambda: time)
    old = plan_turnover(PlanRequest(room_area_id=room.id, service_date='2026-11-06'), user=people['front'], db=db)
    confirm_vacated(old['id'], user=people['front'], db=db)
    start(old['id'], user=people['cleaner'], db=db)
    time += timedelta(minutes=1)
    stay = check_in(room.id, user=people['front'], db=db)
    time += timedelta(minutes=1)
    check_out(room.id, stay['id'], user=people['front'], db=db)
    assert list_turnovers(service_date='2026-11-06', user=people['front'], db=db)['rooms'][0]['needs_another_clean']
    new = plan_turnover(PlanRequest(room_area_id=room.id, service_date='2026-11-06'), user=people['front'], db=db)
    assert new['id'] != old['id']
    assert db.query(models.RoomTurnover).count() == 2
    with pytest.raises(HTTPException):
        plan_turnover(PlanRequest(room_area_id=room.id, service_date='2026-11-06'), user=people['front'], db=db)
    assert list_turnovers(service_date='2026-11-06', user=people['front'], db=db)['rooms'][0]['id'] == new['id']
    time += timedelta(minutes=1)
    confirm_vacated(new['id'], user=people['front'], db=db)
    assert start(new['id'], user=people['cleaner'], db=db)['status'] == 'Cleaning'
    with pytest.raises(HTTPException):
        tick(old['id'], 'linen', TickRequest(checked=True), user=people['cleaner'], db=db)


def test_front_desk_corrects_mistakes_with_audit_history(state):
    from app.routers.housekeeping import check_in, check_out, correct_stay, CorrectionRequest
    db, people, room = state
    stay = check_in(room.id, user=people['front'], db=db)
    check_out(room.id, stay['id'], user=people['front'], db=db)
    with pytest.raises(HTTPException) as error:
        correct_stay(room.id, stay['id'], CorrectionRequest(action='undo_checkout', reason='wrong checkout'), user=people['cleaner'], db=db)
    assert error.value.status_code == 403
    correct_stay(room.id, stay['id'], CorrectionRequest(action='undo_checkout', reason='wrong checkout'), user=people['front'], db=db)
    assert list_turnovers(service_date='2026-11-06', user=people['front'], db=db)['rooms'][0]['guest_stay']['checked_out_at'] is None
    correct_stay(room.id, stay['id'], CorrectionRequest(action='void_checkin', reason='wrong room'), user=people['front'], db=db)
    assert list_turnovers(service_date='2026-11-06', user=people['front'], db=db)['rooms'][0]['guest_stay'] is None
    events = db.query(models.RoomStayCorrection).order_by(models.RoomStayCorrection.id).all()
    assert [e.action for e in events] == ['undo_checkout', 'void_checkin']
    assert all(e.previous_at and e.previous_by_id == people['front'].id for e in events)
    assert check_in(room.id, user=people['front'], db=db)['id'] != stay['id']
    with pytest.raises(HTTPException):
        correct_stay(room.id, stay['id'], CorrectionRequest(action='void_checkin', reason='wrong room'), user=people['front'], db=db)


def test_planned_arrival_and_departure_available_for_selected_upcoming_day(state):
    import json
    from datetime import datetime, timezone
    from app.integration_models import AccountingRoomBooking
    db, people, room = state
    for key, arrival, departure in [('a', '2026-11-07', '2026-11-09'),
                                    ('b', '2026-11-05', '2026-11-07'),
                                    ('c', '2026-11-06', None)]:
        db.add(AccountingRoomBooking(booking_id=key, revision=1, room_ids_json=json.dumps([room.id]),
            check_in=arrival, check_out=departure, status='confirmed', origin='accounting',
            reported_at=datetime(2026, 11, 6, tzinfo=timezone.utc)))
    db.commit()
    day = list_turnovers(service_date='2026-11-07', user=people['cleaner'], db=db)['rooms'][0]
    assert sum(x['check_in'] == '2026-11-07' for x in day['booking_updates']) == 1
    assert sum(x['check_out'] == '2026-11-07' for x in day['booking_updates']) == 1
    assert day['guest_stay'] is None and not day['vacated_confirmed']
    today = list_turnovers(service_date='2026-11-06', user=people['front'], db=db)['rooms'][0]
    assert any(x['check_in'] == '2026-11-06' and x['check_out'] is None for x in today['booking_updates'])
    assert list_turnovers(service_date='2026-11-05', user=people['front'], db=db)['rooms'][0]['booking_updates'] == []


def test_stale_correction_cannot_undo_a_different_action(state):
    from app.routers.housekeeping import check_in, check_out, correct_stay, CorrectionRequest
    db, people, room = state
    stay = check_in(room.id, user=people['front'], db=db)
    check_out(room.id, stay['id'], user=people['front'], db=db)
    with pytest.raises(HTTPException) as error:
        correct_stay(room.id, stay['id'], CorrectionRequest(action='void_checkin', reason='Wrong room selected'), user=people['front'], db=db)
    assert error.value.status_code == 409
    assert db.get(models.RoomStay, stay['id']).checked_out_at is not None
    assert db.query(models.RoomStayCorrection).count() == 0
    correct_stay(room.id, stay['id'], CorrectionRequest(action='undo_checkout', reason='Guest is still here'), user=people['front'], db=db)
    with pytest.raises(HTTPException) as error:
        correct_stay(room.id, stay['id'], CorrectionRequest(action='undo_checkout', reason='Guest is still here'), user=people['front'], db=db)
    assert error.value.status_code == 409
    current = db.get(models.RoomStay, stay['id'])
    assert current.checked_out_at is None and current.voided_at is None
    assert db.query(models.RoomStayCorrection).count() == 1
