"""Receive sanitised Accounting event confirmation into one Operations project.

Do not move booking or financial ownership into Operations. The source owns
booking dates, status, amounts and guest identity. A follow-up update creates
a review item; it does not overwrite staff work or silently reschedule tasks.
"""
import re
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy.orm import Session
from .. import models
from ..integration_models import EventProjectLink

EVENT_NO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
KNOWN_VENUES = {"Function Hall", "Garden", "Terrace", "Cafe", "Café", "Pool", "Restaurant"}
KNOWN_SERVICES = {"venue", "food", "beverage", "addon", "package", "design"}


def prepare_event_project(db: Session, envelope) -> EventProjectLink:
    if envelope.event_type != "event.booking.confirmed":
        raise HTTPException(400, "Not a booking confirmation")
    subject = envelope.subject
    if not subject or subject.type != "event_booking" or not str(subject.id or "").isdigit():
        raise HTTPException(422, "Accounting event source ID is required")
    body = envelope.payload
    if not isinstance(body, dict):
        raise HTTPException(422, "Invalid event detail")
    source_id = str(subject.id)
    if str(body.get("booking_id")) != source_id:
        raise HTTPException(422, "Event source identity mismatch")
    event_no = str(body.get("event_no", "")).strip()
    if not EVENT_NO.fullmatch(event_no):
        raise HTTPException(422, "Invalid event reference")
    day = str(body.get("event_date") or "")
    if not DATE.fullmatch(day):
        raise HTTPException(422, "Event date is required")
    try:
        actual_date = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone(timedelta(hours=8)))
    except ValueError as exc:
        raise HTTPException(422, "Invalid event date") from exc
    services = body.get("services", [])
    if not isinstance(services, list) or len(services) > 12 or any(
        not isinstance(item, str) or item not in KNOWN_SERVICES for item in services
    ):
        raise HTTPException(422, "Invalid service types")
    venue = str(body.get("venue") or "")
    if venue not in KNOWN_VENUES:
        venue = "Check venue in Accounting"

    prior = db.query(EventProjectLink).filter_by(
        source_app="accounting_program", source_record_id=source_id
    ).one_or_none()
    if prior:
        if prior.event_no != event_no:
            raise HTTPException(409, "Event reference changed; manual review required")
        if not db.get(models.Project, prior.project_id):
            raise HTTPException(409, "Linked project missing; reconcile before replay")
        return prior

    def dept(*names):
        for name in names:
            found = db.query(models.Department).filter_by(name=name).first()
            if found:
                return found.id
        return None

    home = dept("Front Desk", "Management")
    if home is None:
        raise HTTPException(409, "Set up Front Desk or Management before event integration")

    due = actual_date.astimezone(timezone.utc)
    project = models.Project(
        title=f"Event preparation · {event_no}",
        department_id=home,
        due_date=due,
        status="Planned",
        priority="High",
        note=f"Event {event_no} · {day} · {venue}. Check the booking details before setup.",
    )
    db.add(project)
    db.flush()
    link = EventProjectLink(
        source_app="accounting_program", source_record_id=source_id,
        event_no=event_no, project_id=project.id
    )
    db.add(link)

    checklist = [
        ("Check the event date, venue and requirements", home, 7),
        ("Confirm layout and event setup plan", home, 5),
        ("Prepare function room and cleaning plan", dept("Housekeeping") or home, 2),
        ("Inspect room, facilities and equipment", dept("Maintenance") or home, 2),
        ("Final venue inspection before guests arrive", home, 0),
        ("Post-event cleanup and turnover", dept("Housekeeping") or home, -1),
    ]
    if "design" in services or "addon" in services:
        checklist.insert(2, ("Confirm design/decorations and approved materials", home, 4))
    if "food" in services or "package" in services:
        checklist.insert(-2, ("Confirm catering preparations and guest count", dept("Kitchen") or home, 2))
    if "beverage" in services or "package" in services:
        checklist.insert(-2, ("Confirm drinks and service setup", dept("Café", "Cafe") or home, 2))

    for title, department_id, days_before in checklist:
        date_due = due - timedelta(days=days_before) if days_before >= 0 else due + timedelta(days=1)
        db.add(models.Task(
            title=title, department_id=department_id, project_id=project.id,
            status="To Do", priority="Normal", due_date=date_due,
            note=f"Event {event_no}. Check the details with your lead.",
        ))
    db.flush()
    return link
