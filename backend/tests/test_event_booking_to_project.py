"""Event confirmations should create one linked project without client or financial data."""
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.integration_models import EventProjectLink
from app.routers.integrations_v2 import IntegrationEventEnvelope, EventSubject, receive_event


@pytest.fixture
def context(monkeypatch):
    monkeypatch.setenv("INTEGRATION_API_KEYS_JSON", json.dumps({
        "hidden_oasis_staff_payroll": "test-key-staff",
        "accounting_program": "test-key-accounting",
        "dedicated_pos_cloud": "test-key-pos",
        "inventory_procurement": "test-key-inventory",
    }))
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, future=True)()
    for name in ("Front Desk", "Housekeeping", "Kitchen", "Maintenance", "Café"):
        db.add(models.Department(name=name))
    db.commit()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


def booking(id="550", event_id="event-booking:550:confirmed", **extra):
    return IntegrationEventEnvelope(
        event_id=event_id, event_type="event.booking.confirmed",
        subject=EventSubject(type="event_booking", id=id),
        payload={"booking_id": int(id), "event_no": "EVT-2026-00550",
                 "event_date": "2026-12-19", "venue": "Function Hall",
                 "services": ["venue", "food", "addon", "design"],
                 "guest_count": 70, **extra}
    )


def test_booking_confirmation_creates_one_project_and_department_tasks(context):
    db = context
    first = receive_event("accounting_program", booking(),
                          x_integration_api_key="test-key-accounting", db=db)
    assert first["status"] == "accepted"
    assert first["project_id"] is not None
    assert db.query(models.Project).count() == 1
    project = db.query(models.Project).one()
    assert "EVT-2026-00550" in project.title
    tasks = db.query(models.Task).filter_by(project_id=project.id).all()
    assert len(tasks) >= 8
    assert any("decorations" in x.title.lower() for x in tasks)
    assert any("catering" in x.title.lower() for x in tasks)
    assert any("clean" in x.title.lower() for x in tasks)
    assert db.query(EventProjectLink).count() == 1
    link = db.query(EventProjectLink).one()
    assert link.venue == "Function Hall"
    assert link.event_date == "2026-12-19"
    house_id = db.query(models.Department).filter_by(name="Housekeeping").one().id
    venue_jobs = [task for task in tasks if task.department_id == house_id]
    assert len(venue_jobs) == 4
    assert sum(task.title.startswith("Before event:") for task in venue_jobs) == 2
    assert sum(task.title.startswith("After event:") for task in venue_jobs) == 2
    assert all("Function Hall" in task.title for task in venue_jobs)
    assert db.query(models.RoomTurnover).count() == 0
    assert all("client" not in (task.note or "").lower() for task in tasks)

    second = receive_event("accounting_program", booking(),
                           x_integration_api_key="test-key-accounting", db=db)
    assert second["status"] == "already_applied"
    assert db.query(models.Project).count() == 1
    assert db.query(models.Task).count() == len(tasks)

    changed = IntegrationEventEnvelope(
        event_id="event-booking:550:changed:test", event_type="event.booking.changed",
        subject=EventSubject(type="event_booking", id="550"),
        payload={"booking_id": 550, "event_date": "2026-12-20",
                 "venue": "Garden", "services": ["venue"]},
    )
    receive_event("accounting_program", changed,
                  x_integration_api_key="test-key-accounting", db=db)
    assert db.query(models.Project).count() == 1
    assert db.query(models.Task).count() == len(tasks)
    assert db.query(models.ExternalReviewItem).count() == 2


def test_booking_receiver_rejects_bad_id_or_date_before_creating_a_project(context):
    db = context
    with pytest.raises(HTTPException) as err:
        receive_event("accounting_program", booking(id="501", booking_id=550),
                      x_integration_api_key="test-key-accounting", db=db)
    assert err.value.status_code == 422
    db.rollback()
    assert db.query(models.Project).count() == 0

    with pytest.raises(HTTPException):
        receive_event("accounting_program", booking(event_date="2026-02-30"),
                      x_integration_api_key="test-key-accounting", db=db)
    db.rollback()
    assert db.query(models.Project).count() == 0


def test_cross_app_event_type_not_allowed_from_pos(context):
    db = context
    with pytest.raises(HTTPException) as err:
        receive_event("dedicated_pos_cloud", booking(),
                      x_integration_api_key="test-key-pos", db=db)
    assert err.value.status_code == 400


def test_garden_event_keeps_garden_venue_and_never_creates_room_turnover(context):
    db = context
    result = receive_event("accounting_program",
                           booking(id="551", event_id="event-booking:551:confirmed",
                                   event_no="EVT-2026-00551", venue="Garden"),
                           x_integration_api_key="test-key-accounting", db=db)
    assert result["status"] == "accepted"
    link = db.query(EventProjectLink).one()
    assert link.venue == "Garden"
    tasks = db.query(models.Task).filter_by(project_id=link.project_id).all()
    house_id = db.query(models.Department).filter_by(name="Housekeeping").one().id
    venue_jobs = [task.title for task in tasks if task.department_id == house_id]
    assert len(venue_jobs) == 4
    assert all("Garden" in name and "Function Hall" not in name for name in venue_jobs)
    assert db.query(models.RoomTurnover).count() == 0
