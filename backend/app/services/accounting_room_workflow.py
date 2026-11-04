"""Accounting relays Beds24 room dates/status; staff still verify vacancy.

Room IDs must be mapped explicitly. A combined Accounting room may map to two
physical rooms. Never infer checkout from a date or update Beds24 inventory.
"""
import json
import os
from datetime import date

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from .. import models
from ..clock import utc_now
from ..integration_models import AccountingRoomBooking

ACTIVE = {"confirmed", "checked_in", "checked_out"}
CHECK_KEYS = ("linen", "bathroom", "towels", "surfaces", "floor", "bins", "supplies", "equipment", "belongings", "final")


class RoomSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    booking_id: StrictInt = Field(gt=0)
    room_id: StrictInt | None = Field(default=None, gt=0)
    revision: StrictInt = Field(gt=0)
    check_in: date | None = None
    check_out: date | None = None
    status: str
    origin: str


def _mapped_rooms(db, room_id):
    try:
        mapping = json.loads(os.getenv("ACCOUNTING_ROOM_MAP_JSON", "{}"))
        if not isinstance(mapping, dict):
            raise ValueError()
        ids = mapping.get(str(room_id), [])
        if isinstance(ids, int) and not isinstance(ids, bool):
            ids = [ids]
        if not isinstance(ids, list) or any(type(i) is not int or i < 1 for i in ids) or len(set(ids)) != len(ids):
            raise ValueError()
        for room in ids:
            found = db.get(models.RoomArea, room)
            if not found or found.kind != "room":
                raise ValueError()
        return ids
    except (ValueError, TypeError):
        raise HTTPException(503, "Accounting room mapping needs administrator review.")



def configured_room_ids(db):
    raw = os.getenv("ACCOUNTING_ROOM_MAP_JSON", "").strip()
    if not raw:
        return None
    try:
        mapping = json.loads(raw)
        if not isinstance(mapping, dict):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(503, "Accounting room mapping needs administrator review.")
    return {room for key in mapping for room in _mapped_rooms(db, key)}


def _reconcile(db, room_id, day):
    if not day:
        return
    # A rollout date prevents old imported bookings from generating historic work.
    cutoff = os.getenv("ACCOUNTING_HOUSEKEEPING_START_DATE", "").strip()
    if not cutoff:
        return
    try:
        if date.fromisoformat(day) < date.fromisoformat(cutoff):
            return
    except ValueError:
        raise HTTPException(503, "Accounting housekeeping start date needs administrator review.")
    active = any(room_id in json.loads(row.room_ids_json) for row in db.query(AccountingRoomBooking).filter(
        AccountingRoomBooking.check_out == day,
        AccountingRoomBooking.status.in_(ACTIVE),
    ).all())
    row = db.query(models.RoomTurnover).filter_by(room_area_id=room_id, service_date=day).order_by(models.RoomTurnover.cycle.desc()).with_for_update().first()
    if active and not row:
        db.add(models.RoomTurnover(room_area_id=room_id, service_date=day,
            source="accounting", status="Needs cleaning", vacated_confirmed=False,
            items_json=json.dumps({key: False for key in CHECK_KEYS})))
    elif not active and row and row.source == "accounting" and row.status == "Needs cleaning" and not row.vacated_confirmed and row.started_by_id is None:
        # Only withdraw an untouched automatic request. Preserve every staff action.
        db.delete(row)


def apply_room_snapshot(db, event):
    try:
        data = RoomSnapshot.model_validate(event.payload)
    except ValueError:
        raise HTTPException(422, "Room update must contain only valid room, date and booking status fields.")
    if not event.subject or event.subject.type != "room_booking" or event.subject.id != str(data.booking_id):
        raise HTTPException(422, "Room booking source identity mismatch.")
    if data.status not in ACTIVE | {"cancelled", "no_show", "unknown"} or data.origin not in {"beds24", "accounting"}:
        raise HTTPException(422, "Unknown room booking status or origin.")
    if data.check_in and data.check_out and data.check_out < data.check_in:
        raise HTTPException(422, "Checkout cannot be earlier than arrival.")
    row = db.query(AccountingRoomBooking).filter_by(booking_id=str(data.booking_id)).with_for_update().first()
    if row and data.revision <= row.revision:
        return {"applied": False, "reason": "older_revision"}
    previous_rooms = json.loads(row.room_ids_json) if row else []
    previous_day = row.check_out if row else None
    rooms = _mapped_rooms(db, data.room_id)
    if not row:
        row = AccountingRoomBooking(booking_id=str(data.booking_id))
        db.add(row)
    row.revision = data.revision
    row.accounting_room_id = data.room_id
    row.room_ids_json = json.dumps(rooms)
    row.check_in = data.check_in.isoformat() if data.check_in else None
    row.check_out = data.check_out.isoformat() if data.check_out else None
    row.status = data.status
    row.origin = data.origin
    row.reported_at = utc_now()
    db.flush()
    # Consistent locking order for combined rooms and room transfers.
    for room, day in sorted(set([(r, previous_day or "") for r in previous_rooms] + [(r, row.check_out or "") for r in rooms])):
        _reconcile(db, room, day)
    return {"applied": True, "mapped": bool(rooms), "room_count": len(rooms)}
