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
    # Serialize generation for this guest across workers on PostgreSQL.
    guest = db.query(models.GuestNote).filter(models.GuestNote.id == guest_id).with_for_update().one_or_none()
    if guest is None:
        raise HTTPException(status_code=404, detail="Guest note not found")
    authorize_action(db, user, "guests", Action.TRANSITION, obj=guest)

    if guest.hidden_from_active or guest.status not in {"Open", "Follow"}:
        raise HTTPException(
            status_code=409,
            detail="Reopen the guest matter before creating a maintenance Fix.",
        )

    resolved_department_id = department_id if department_id is not None else guest.department_id
    authorize_action(db, user, "fixes", Action.CREATE, department_id=resolved_department_id)

    # A client retry must return the same Fix, never create a second ticket.
    # Also recognize older records where the reverse guest->fix link was lost.
    existing = None
    if guest.linked_fix_id is not None:
        existing = db.get(models.Fix, guest.linked_fix_id)
        if existing is None or existing.linked_guest_note_id != guest.id:
            raise HTTPException(
                status_code=409,
                detail="The guest matter has an inconsistent maintenance link; review it before proceeding.",
            )
    if existing is None:
        existing = (
            db.query(models.Fix)
            .filter(models.Fix.linked_guest_note_id == guest.id)
            .order_by(models.Fix.id.asc())
            .first()
        )
    if existing is not None:
        # The caller may be allowed to see the guest matter but not a Fix
        # assigned to another department. Do not reveal that ticket.
        authorize_action(db, user, "fixes", Action.VIEW, obj=existing)
        if department_id is not None and existing.department_id != department_id:
            raise HTTPException(
                status_code=409,
                detail="This guest matter already has a Fix in a different department.",
            )
        if guest.linked_fix_id is None:
            guest.linked_fix_id = existing.id
            db.commit()
            db.refresh(guest)
        return guest, existing

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
