import json
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.integration_models import AccountingRoomBooking, IntegrationDelivery
from app.routers.housekeeping import confirm_vacated, start
from app.routers.integrations_v2 import IntegrationEventEnvelope, receive_event


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setenv('INTEGRATION_API_KEYS_JSON', json.dumps({'accounting_program': 'room-test-key'}))
    monkeypatch.setenv('ACCOUNTING_HOUSEKEEPING_START_DATE', '2026-11-03')
    monkeypatch.setattr('app.routers.housekeeping.utc_now', lambda: datetime(2026, 11, 3, tzinfo=timezone.utc))
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, autoflush=False)() as session:
        session.add_all([models.RoomArea(id=1, name='Perch 2'), models.RoomArea(id=2, name='Crown')])
        session.commit()
        monkeypatch.setenv('ACCOUNTING_ROOM_MAP_JSON', '{"9":[1,2]}')
        yield session
    engine.dispose()


def send(db, revision, **changes):
    payload = dict(booking_id=55, room_id=9, revision=revision, check_in='2026-11-02',
                   check_out='2026-11-03', status='confirmed', origin='beds24')
    payload.update(changes)
    event = IntegrationEventEnvelope(event_id=f'room-test:55:{revision}', event_type='room.booking.updated',
        subject={'type': 'room_booking', 'id': '55'}, payload=payload)
    return receive_event('accounting_program', event, x_integration_api_key='room-test-key', db=db)


def test_combined_room_has_two_requests_but_checkout_is_not_vacancy(db):
    result = send(db, 1)
    assert result['room_update']['room_count'] == 2
    requests = db.query(models.RoomTurnover).all()
    assert len(requests) == 2
    assert all(not row.vacated_confirmed and row.source == 'accounting' for row in requests)
    assert send(db, 1)['status'] == 'already_applied'
    send(db, 2, status='checked_out')
    assert db.query(models.RoomTurnover).count() == 2
    assert all(not row.vacated_confirmed for row in requests)
    assert all(row.status == 'active' for row in db.query(models.RoomArea))


def test_old_retry_cannot_reverse_cancel_or_recreate_work(db):
    send(db, 10)
    send(db, 12, status='cancelled')
    assert db.query(models.RoomTurnover).count() == 0
    assert send(db, 11, status='checked_out')['room_update']['reason'] == 'older_revision'
    assert db.query(models.RoomTurnover).count() == 0
    assert db.query(AccountingRoomBooking).one().status == 'cancelled'


def test_date_change_moves_only_untouched_requests_and_preserves_staff_work(db):
    send(db, 1)
    rows = db.query(models.RoomTurnover).order_by(models.RoomTurnover.id).all()
    rows[0].vacated_confirmed = True
    rows[0].status = 'Cleaning'
    db.commit()
    send(db, 2, check_out='2026-11-04')
    assert db.query(models.RoomTurnover).filter_by(service_date='2026-11-03').count() == 1
    assert rows[0].status == 'Cleaning' and rows[0].vacated_confirmed
    assert db.query(models.RoomTurnover).filter_by(service_date='2026-11-04').count() == 2


def test_unmapped_rooms_are_reviewed_and_never_guessed(db):
    assert send(db, 1, room_id=999)['room_update']['mapped'] is False
    assert db.query(models.RoomTurnover).count() == 0
    assert db.query(models.ExternalReviewItem).one().title == 'Room booking needs room mapping'


def test_old_imports_and_no_shows_do_not_create_cleaning(db):
    send(db, 1, check_in='2026-10-01', check_out='2026-10-02', status='checked_out')
    assert db.query(models.RoomTurnover).count() == 0
    send(db, 2, status='no_show')
    assert db.query(models.RoomTurnover).count() == 0


def test_private_fields_rejected_before_persisting(db):
    with pytest.raises(HTTPException) as err:
        send(db, 1, guest_name='PRIVATE NAME', price=10000)
    assert err.value.status_code == 422
    db.rollback()
    assert db.query(IntegrationDelivery).count() == 0


def test_future_checkout_cannot_be_confirmed_or_started(db):
    send(db, 1, check_out='2026-11-04')
    owner = models.User(name='Front desk manager', role='manager')
    db.add(owner)
    db.commit()
    request = db.query(models.RoomTurnover).first()
    with pytest.raises(HTTPException) as err:
        confirm_vacated(request.id, user=owner, db=db)
    assert err.value.status_code == 409
    with pytest.raises(HTTPException):
        start(request.id, user=owner, db=db)


def test_snapshot_and_work_roll_back_with_failed_transaction(db):
    from app.services.accounting_room_workflow import apply_room_snapshot
    apply_room_snapshot(db, IntegrationEventEnvelope(event_id='test', event_type='room.booking.updated',
        subject={'type':'room_booking','id':'55'}, payload=dict(booking_id=55, room_id=9,
            revision=1, check_in='2026-11-02', check_out='2026-11-03', status='confirmed', origin='beds24')))
    db.rollback()
    assert db.query(AccountingRoomBooking).count() == 0
    assert db.query(models.RoomTurnover).count() == 0
