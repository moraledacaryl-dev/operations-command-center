from datetime import timedelta
from sqlalchemy.orm import Session
from . import models
from .clock import utc_now
from .utils import log_activity


def _hide(obj, reason: str):
    obj.hidden_from_active = True
    obj.archived_at = utc_now()
    obj.archive_reason = reason


def run_auto_archive(db: Session, *, actor_id: int | None = None) -> dict:
    now = utc_now()
    counts = {
        "tasks": 0,
        "guests": 0,
        "fixes": 0,
        "approvals": 0,
        "posts": 0,
        "memos": 0,
        "projects": 0,
        "shift": 0,
    }

    def archive(obj, resource: str, reason: str):
        _hide(obj, reason)
        if actor_id is not None:
            # Commit attribution and archival together, preserving the record's
            # existing activity trail and exposing no private payload in logs.
            log_activity(db, resource, obj.id, "archived", "Moved into History by manual archive.",
                         actor_id=actor_id, metadata={"reason": reason, "trigger": "manual_archive"})

    for task in db.query(models.Task).filter(models.Task.hidden_from_active == False, models.Task.status == "Done").all():
        if task.completed_at and task.completed_at < now - timedelta(hours=24):
            archive(task, "tasks", "done_24h")
            counts["tasks"] += 1

    for guest in db.query(models.GuestNote).filter(models.GuestNote.hidden_from_active == False, models.GuestNote.status == "Done").all():
        if guest.completed_at and guest.completed_at < now - timedelta(hours=48):
            archive(guest, "guests", "resolved_48h")
            counts["guests"] += 1

    for fix in db.query(models.Fix).filter(models.Fix.hidden_from_active == False, models.Fix.status == "Verified").all():
        if fix.completed_at and fix.completed_at < now - timedelta(hours=24):
            archive(fix, "fixes", "verified_24h")
            counts["fixes"] += 1

    for approval in db.query(models.Approval).filter(models.Approval.hidden_from_active == False, models.Approval.status.in_(["Approved", "Rejected"])).all():
        archive(approval, "approvals", "decision_done")
        counts["approvals"] += 1

    for post in db.query(models.Post).filter(models.Post.hidden_from_active == False, models.Post.status == "Posted").all():
        if post.completed_at and post.completed_at < now - timedelta(hours=12):
            archive(post, "posts", "posted")
            counts["posts"] += 1

    for memo in db.query(models.Memo).filter(models.Memo.hidden_from_active == False).all():
        if memo.expiry_date and memo.expiry_date < now:
            archive(memo, "memos", "expired")
            counts["memos"] += 1

    for project in db.query(models.Project).filter(models.Project.hidden_from_active == False, models.Project.status == "Done").all():
        if project.completed_at and project.completed_at < now - timedelta(days=3):
            archive(project, "projects", "done_3d")
            counts["projects"] += 1

    for note in db.query(models.ShiftNote).filter(models.ShiftNote.hidden_from_active == False, models.ShiftNote.status.in_(["Seen", "Done"])).all():
        if note.updated_at and note.updated_at < now - timedelta(hours=12):
            archive(note, "shift-notes", "seen_next_shift")
            counts["shift"] += 1

    db.commit()
    return counts
