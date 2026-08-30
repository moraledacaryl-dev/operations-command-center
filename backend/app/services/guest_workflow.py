from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..utils import log_activity


def create_fix_from_guest(
    db: Session,
    user: models.User,
    guest_id: int,
    department_id: int | None = None,
    note: str | None = None,
) -> tuple[models.GuestNote, models.Fix]:
    guest = db.query(models.GuestNote).filter(models.GuestNote.id == guest_id).with_for_update().one_or_none()
    if guest is None:
        raise HTTPException(status_code=404, detail="Guest note not found")
    authorize_action(db, user, "guests", Action.TRANSITION, obj=guest)
    resolved_department_id = department_id or guest.department_id
    authorize_action(db, user, "fixes", Action.CREATE, department_id=resolved_department_id)
    guest.department_id = guest.department_id or resolved_department_id
    fix = models.Fix(
        title=guest.title,
        department_id=resolved_department_id,
        room_area_id=guest.room_area_id,
        problem=note or guest.note or guest.action_taken or guest.issue_type,
        urgency=guest.urgency or "Normal",
        status="Open",
        reported_by_id=user.id,
        linked_guest_note_id=guest.id,
        note=f"Created from guest note #{guest.id}.",
    )
    db.add(fix)
    db.flush()
    guest.linked_fix_id = fix.id
    guest.status = "Follow"
    log_activity(db, "guests", guest.id, "created_fix", f"Created fix #{fix.id}", actor_id=user.id)
    log_activity(db, "fixes", fix.id, "created", f"Created from guest note #{guest.id}", actor_id=user.id)
    db.commit()
    db.refresh(guest)
    db.refresh(fix)
    return guest, fix


__all__ = ["create_fix_from_guest"]
