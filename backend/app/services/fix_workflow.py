from __future__ import annotations

import re
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..capabilities import has_capability
from ..utils import log_activity


ATTACHMENT_DOWNLOAD_RE = re.compile(r"^/api/attachments/(\d+)/download$")


def _lock_fix(db: Session, fix_id: int) -> models.Fix:
    row = db.query(models.Fix).filter(models.Fix.id == fix_id).with_for_update().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Fix not found")
    return row


def _transition(db: Session, user: models.User, fix_id: int, expected: str, target: str, note: str | None = None):
    fix = _lock_fix(db, fix_id)
    authorize_action(db, user, "fixes", Action.TRANSITION, obj=fix)
    if fix.status != expected:
        raise HTTPException(status_code=409, detail=f"Fix must be {expected} before moving to {target}")
    fix.status = target
    if note:
        fix.note = f"{fix.note or ''}\n\n{target}: {note}".strip()
    log_activity(db, "fixes", fix.id, "status", f"Fix {expected} → {target}", actor_id=user.id, metadata={"note": note})
    db.commit()
    db.refresh(fix)
    return fix


def start_fix(db: Session, user: models.User, fix_id: int, note: str | None = None):
    return _transition(db, user, fix_id, "Open", "Working", note)


def finish_fix(db: Session, user: models.User, fix_id: int, note: str | None = None):
    return _transition(db, user, fix_id, "Working", "Done", note)


def verify_fix(db: Session, user: models.User, fix_id: int, note: str | None, proof_url: str | None = None, filename: str | None = None):
    if not (note or "").strip():
        raise HTTPException(status_code=400, detail="Verification note is required")
    fix = _lock_fix(db, fix_id)
    authorize_action(db, user, "fixes", Action.VIEW, obj=fix)
    if not has_capability(user.role, "make_decisions"):
        raise HTTPException(status_code=403, detail="Decision authority is required to verify a Fix")
    if fix.status != "Done":
        raise HTTPException(status_code=409, detail="Only Done fixes can be verified")

    now = models.utcnow()
    fix.status = "Verified"
    fix.verified_at = now
    fix.verified_by_id = user.id
    fix.completed_at = now
    db.add(models.Comment(parent_type="fixes", parent_id=fix.id, body=note.strip(), author_id=user.id, comment_type="Verification"))
    if proof_url:
        match = ATTACHMENT_DOWNLOAD_RE.match(proof_url.strip())
        if match:
            attachment = db.get(models.Attachment, int(match.group(1)))
            if not attachment or attachment.parent_type != "fixes" or attachment.parent_id != fix.id:
                raise HTTPException(status_code=400, detail="Verification attachment does not belong to this Fix")
        else:
            existing = db.query(models.Attachment).filter(
                models.Attachment.parent_type == "fixes",
                models.Attachment.parent_id == fix.id,
                models.Attachment.file_url == proof_url,
            ).first()
            if existing is None:
                db.add(models.Attachment(parent_type="fixes", parent_id=fix.id, filename=filename or "Verification proof", file_url=proof_url, uploaded_by_id=user.id))
    if fix.linked_guest_note_id:
        guest = db.get(models.GuestNote, fix.linked_guest_note_id)
        if guest:
            guest.status = "Done"
            guest.action_taken = note.strip()
            guest.completed_at = now
            log_activity(db, "guests", guest.id, "resolved", f"Resolved by fix #{fix.id}", actor_id=user.id)
    log_activity(db, "fixes", fix.id, "verified", "Fix verified", actor_id=user.id, metadata={"note": note, "proof_url": proof_url})
    db.commit()
    db.refresh(fix)
    return fix


def reopen_fix(db: Session, user: models.User, fix_id: int, reason: str | None):
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Reopen reason is required")
    fix = _lock_fix(db, fix_id)
    authorize_action(db, user, "fixes", Action.VIEW, obj=fix)
    if not has_capability(user.role, "make_decisions"):
        raise HTTPException(status_code=403, detail="Decision authority is required to reopen a verified Fix")
    if fix.status != "Verified":
        raise HTTPException(status_code=409, detail="Only Verified fixes can be reopened")
    fix.status = "Working"
    fix.verified_at = None
    fix.verified_by_id = None
    fix.completed_at = None
    fix.note = f"{fix.note or ''}\n\nReopened: {reason.strip()}".strip()
    log_activity(db, "fixes", fix.id, "reopened", reason.strip(), actor_id=user.id)
    db.commit()
    db.refresh(fix)
    return fix
