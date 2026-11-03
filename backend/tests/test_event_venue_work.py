"""Venue jobs are scoped Housekeeping tasks, not guest-room cleaning records."""
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.database import Base
from app.integration_models import EventProjectLink
from app.routers.housekeeping import list_event_venues
from app.routers.integrations_v2 import IntegrationEventEnvelope, EventSubject, receive_event


@pytest.fixture
def state(monkeypatch):
    monkeypatch.setenv("INTEGRATION_API_KEYS_JSON", json.dumps({
        "accounting_program": "test-key-accounting",
        "hidden_oasis_staff_payroll": "test-key-staff",
        "dedicated_pos_cloud": "test-key-pos",
        "inventory_procurement": "test-key-inventory",
    }))
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, future=True)()
    departments = {
        name: models.Department(name=name)
        for name in ("Front Desk", "Housekeeping", "Kitchen", "Maintenance", "Management")
    }
    db.add_all(departments.values())
    db.flush()
    people = {
        "house": models.User(name="Fictional cleaner", role="staff",
                             department_id=departments["Housekeeping"].id, is_active=True),
        "lead": models.User(name="Fictional lead", role="lead",
                            department_id=departments["Housekeeping"].id, is_active=True),
        "front": models.User(name="Fictional reception", role="staff",
                             department_id=departments["Front Desk"].id, is_active=True),
        "kitchen": models.User(name="Fictional cook", role="staff",
                               department_id=departments["Kitchen"].id, is_active=True),
        "owner": models.User(name="Fictional owner", role="owner",
                             department_id=departments["Management"].id, is_active=True),
    }
    db.add_all(people.values())
    db.commit()
    try:
        yield db, people
    finally:
        db.close()
        engine.dispose()


def confirm_garden_event(db):
    return receive_event("accounting_program", IntegrationEventEnvelope(
        event_id="event-booking:551:confirmed",
        event_type="event.booking.confirmed",
        subject=EventSubject(type="event_booking", id="551"),
        payload={
            "booking_id": 551, "event_no": "EVT-2026-00551",
            "event_date": "2026-12-19", "venue": "Garden",
            "services": ["venue", "design"], "guest_count": 65,
        },
    ), x_integration_api_key="test-key-accounting", db=db)


def test_venue_jobs_are_hk_scoped_and_separate_from_rooms(state):
    db, people = state
    assert list_event_venues(user=people["house"], db=db) == {"events": []}
    confirm_garden_event(db)

    board = list_event_venues(user=people["house"], db=db)
    assert len(board["events"]) == 1
    event = board["events"][0]
    assert event["event_no"] == "EVT-2026-00551"
    assert event["venue"] == "Garden"
    assert event["event_date"] == "2026-12-19"
    assert len(event["tasks"]) == 4
    assert [task["phase"] for task in event["tasks"]].count("Before event") == 2
    assert [task["phase"] for task in event["tasks"]].count("After event") == 2
    assert all("Garden" in task["title"] for task in event["tasks"])
    assert all(task["status"] == "To Do" for task in event["tasks"])
    assert db.query(models.RoomTurnover).count() == 0

    for blocked in ("front", "kitchen"):
        with pytest.raises(HTTPException) as exc:
            list_event_venues(user=people[blocked], db=db)
        assert exc.value.status_code == 403
    assert list_event_venues(user=people["lead"], db=db) == board
    assert list_event_venues(user=people["owner"], db=db) == board


def test_archived_tasks_and_projects_are_hidden_and_unknown_venue_is_not_guessed(state):
    db, people = state
    confirm_garden_event(db)
    link = db.query(EventProjectLink).one()
    link.venue = None
    link.event_date = None
    task = db.query(models.Task).filter_by(project_id=link.project_id).first()
    task.archived_at = utc_now()
    db.commit()
    event = list_event_venues(user=people["house"], db=db)["events"][0]
    assert event["venue"] == "Check venue in Accounting"
    assert event["event_date"] is None
    assert all(item["id"] != task.id for item in event["tasks"])
    db.get(models.Project, link.project_id).archived_at = utc_now()
    db.commit()
    assert list_event_venues(user=people["house"], db=db) == {"events": []}
