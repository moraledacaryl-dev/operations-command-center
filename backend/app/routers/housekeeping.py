"""Manual, department-scoped room cleaning and inspection.

Only Front Desk/management can verify a room has been vacated, after checking
the PMS. Housekeeping marks work done; another authorized lead inspects.
Neither action changes PMS reservations or Rooms inventory status.
"""
import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..clock import utc_now
from ..database import get_db
from ..integration_models import AccountingRoomBooking
from ..services.accounting_room_workflow import configured_room_ids
from .api import require_user

router = APIRouter(prefix="/api/housekeeping", tags=["Housekeeping"])
TZ = ZoneInfo("Asia/Manila")
ITEMS = (
    ("linen", "Change sheets and pillowcases"),
    ("bathroom", "Clean and disinfect bathroom"),
    ("towels", "Replace towels and toiletries"),
    ("surfaces", "Wipe tables, switches and touch points"),
    ("floor", "Sweep and mop or vacuum"),
    ("bins", "Empty bins"),
    ("supplies", "Refill water and room supplies"),
    ("equipment", "Check lights, air conditioner and other equipment"),
    ("belongings", "Check for guest belongings and report to Front Desk"),
    ("final", "Lock room and report anything damaged"),
)
STATES = {"Needs cleaning", "Cleaning", "For inspection", "Cleared", "Needs rework"}


class PlanRequest(BaseModel):
    room_area_id: int = Field(ge=1)
    service_date: str


class TickRequest(BaseModel):
    checked: bool


class InspectionRequest(BaseModel):
    cleared: bool
    note: str = Field(default="", max_length=400)


def _date(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Use a valid date (YYYY-MM-DD).")


def _belongs(db: Session, user: models.User, department_name: str) -> bool:
    if user.department_id:
        department = db.get(models.Department, user.department_id)
        if department and department.name == department_name:
            return True
    return db.query(models.UserDepartment.id).join(
        models.Department, models.UserDepartment.department_id == models.Department.id
    ).filter(models.UserDepartment.user_id == user.id,
             models.Department.name == department_name).first() is not None


def _role(user: models.User) -> str:
    return str(user.role or "").lower()


def _manager(user: models.User) -> bool:
    return _role(user) in {"owner", "admin", "manager"}


def _house(db: Session, user: models.User) -> bool:
    return _manager(user) or _belongs(db, user, "Housekeeping")


def _frontdesk(db: Session, user: models.User) -> bool:
    return _manager(user) or _belongs(db, user, "Front Desk")


def _inspector(db: Session, user: models.User) -> bool:
    return _manager(user) or (_role(user) == "lead" and _belongs(db, user, "Housekeeping"))


def _can_view(db: Session, user: models.User) -> bool:
    return _house(db, user) or _frontdesk(db, user)


def _require(permission: bool):
    if not permission:
        raise HTTPException(status_code=403, detail="This action requires the correct department or role.")


def _row(db: Session, turnover_id: int):
    result = db.get(models.RoomTurnover, turnover_id)
    if not result:
        raise HTTPException(status_code=404, detail="Cleaning record not found.")
    return result


def _items(row):
    try:
        result = json.loads(row.items_json)
        if not isinstance(result, dict) or set(result) != {key for key, _ in ITEMS}:
            raise ValueError()
        return result
    except (TypeError, ValueError):
        raise HTTPException(status_code=409, detail="Cleaning checklist needs administrator review.")


def _present(row, room):
    items = _items(row)
    return {
        "id": row.id, "room_area_id": row.room_area_id,
        "room_name": room.name,
        "service_date": row.service_date,
        "status": row.status,
        "source": row.source,
        "vacated_confirmed": row.vacated_confirmed,
        "started_by_id": row.started_by_id,
        "submitted_by_id": row.submitted_by_id,
        "inspected_by_id": row.inspected_by_id,
        "inspected_at": row.inspected_at.isoformat() if row.inspected_at else None,
        "rework_note": row.rework_note,
        "checklist": [{"key": key, "label": label, "checked": bool(items[key])} for key, label in ITEMS],
    }


@router.get("/turnovers")
def list_turnovers(
    service_date: str = Query(default=""),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    _require(_can_view(db, user))
    day = _date(service_date or utc_now().astimezone(TZ).date().isoformat())
    rooms = db.query(models.RoomArea).filter(models.RoomArea.kind == "room").order_by(models.RoomArea.name).all()
    existing = {v.room_area_id: v for v in db.query(models.RoomTurnover).filter_by(service_date=day).all()}
    mapped_ids = configured_room_ids(db)
    if mapped_ids is not None:
        rooms = [room for room in rooms if room.id in mapped_ids or room.id in existing]
    records = [_present(existing[r.id], r) if r.id in existing else {
        "id": None, "room_area_id": r.id, "room_name": r.name,
        "service_date": day, "status": "No cleaning request", "source": None,
        "vacated_confirmed": False, "checklist": [],
    } for r in rooms]
    snapshots = db.query(AccountingRoomBooking).filter(AccountingRoomBooking.check_out == day).all()
    for record in records:
        record["booking_updates"] = [{
            "status": snapshot.status, "origin": snapshot.origin,
            "check_out": snapshot.check_out,
            "reported_at": snapshot.reported_at.isoformat(),
        } for snapshot in snapshots if record["room_area_id"] in json.loads(snapshot.room_ids_json)]
    return {"date": day, "rooms": records,
            "accounting_connected": bool(os.getenv("ACCOUNTING_ROOM_MAP_JSON", "").strip()),
            "can_schedule": _frontdesk(db, user),
            "can_clean": _house(db, user),
            "can_inspect": _inspector(db, user)}


@router.post("/turnovers", status_code=201)
def plan_turnover(
    payload: PlanRequest,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    _require(_frontdesk(db, user))
    day = _date(payload.service_date)
    room = db.get(models.RoomArea, payload.room_area_id)
    if not room or room.kind != "room":
        raise HTTPException(status_code=404, detail="Guest room not found")
    if db.query(models.RoomTurnover).filter_by(
        room_area_id=room.id, service_date=day
    ).first():
        raise HTTPException(status_code=409, detail="A cleaning record already exists for this room and date.")
    row = models.RoomTurnover(
        room_area_id=room.id, service_date=day, status="Needs cleaning",
        source="manual", vacated_confirmed=False,
        items_json=json.dumps({key: False for key, _ in ITEMS}),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A cleaning record already exists.")
    db.refresh(row)
    return _present(row, room)


@router.post("/turnovers/{turnover_id}/confirm-vacated")
def confirm_vacated(turnover_id: int, user: models.User = Depends(require_user),
                   db: Session = Depends(get_db)):
    _require(_frontdesk(db, user))
    row = _row(db, turnover_id)
    if row.status not in {"Needs cleaning", "Needs rework"}:
        raise HTTPException(status_code=409, detail="Check the cleaning stage before confirming checkout.")
    if row.service_date > utc_now().astimezone(TZ).date().isoformat():
        raise HTTPException(status_code=409, detail="Confirm the room is empty on the cleaning date, not in advance.")
    row.vacated_confirmed = True
    row.vacated_by_id = user.id
    row.vacated_at = utc_now()
    db.commit()
    return _present(row, db.get(models.RoomArea, row.room_area_id))


@router.post("/turnovers/{turnover_id}/start")
def start(turnover_id: int, user: models.User = Depends(require_user),
          db: Session = Depends(get_db)):
    _require(_house(db, user))
    row = _row(db, turnover_id)
    if row.service_date > utc_now().astimezone(TZ).date().isoformat():
        raise HTTPException(status_code=409, detail="Wait until the cleaning date before starting this room.")
    if not row.vacated_confirmed:
        raise HTTPException(status_code=409, detail="Front Desk must verify checkout before cleaning starts.")
    if row.status not in {"Needs cleaning", "Needs rework"}:
        raise HTTPException(status_code=409, detail="This room cannot be started at its current stage.")
    row.status = "Cleaning"
    row.started_by_id = user.id
    row.submitted_by_id = None
    row.inspected_by_id = None
    row.inspected_at = None
    db.commit()
    return _present(row, db.get(models.RoomArea, row.room_area_id))


@router.patch("/turnovers/{turnover_id}/items/{item_key}")
def tick(turnover_id: int, item_key: str, payload: TickRequest,
         user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    _require(_house(db, user))
    row = _row(db, turnover_id)
    if row.status != "Cleaning" or row.started_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the assigned cleaner can update an active checklist.")
    items = _items(row)
    if item_key not in items:
        raise HTTPException(status_code=404, detail="Checklist item not found.")
    items[item_key] = payload.checked
    row.items_json = json.dumps(items)
    db.commit()
    return _present(row, db.get(models.RoomArea, row.room_area_id))


@router.post("/turnovers/{turnover_id}/submit")
def submit(turnover_id: int, user: models.User = Depends(require_user),
           db: Session = Depends(get_db)):
    _require(_house(db, user))
    row = _row(db, turnover_id)
    if row.status != "Cleaning" or row.started_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the assigned cleaner can submit this room.")
    if not all(_items(row).values()):
        raise HTTPException(status_code=409, detail="Complete every checklist item before requesting inspection.")
    row.status = "For inspection"
    row.submitted_by_id = user.id
    db.commit()
    return _present(row, db.get(models.RoomArea, row.room_area_id))


@router.post("/turnovers/{turnover_id}/inspect")
def inspect(turnover_id: int, payload: InspectionRequest,
            user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    _require(_inspector(db, user))
    row = _row(db, turnover_id)
    if row.status != "For inspection":
        raise HTTPException(status_code=409, detail="This room is not waiting for inspection.")
    if user.id == row.started_by_id:
        raise HTTPException(status_code=403, detail="A different supervisor must inspect this room.")
    if payload.cleared:
        row.status = "Cleared"
        row.inspected_by_id = user.id
        row.inspected_at = utc_now()
        row.rework_note = None
    else:
        note = payload.note.strip()
        if len(note) < 5:
            raise HTTPException(status_code=422, detail="Explain what needs cleaning again.")
        row.status = "Needs rework"
        row.rework_note = note
        row.items_json = json.dumps({key: False for key, _ in ITEMS})
    db.commit()
    return _present(row, db.get(models.RoomArea, row.room_area_id))
