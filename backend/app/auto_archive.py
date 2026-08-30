from datetime import timedelta
from sqlalchemy.orm import Session
from . import models
from .clock import utc_now


def _hide(obj, reason: str):
    obj.hidden_from_active = True
    obj.archived_at = utc_now()
    obj.archive_reason = reason


def run_auto_archive(db: Session) -> dict:
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

    for task in db.query(models.Task).filter(models.Task.hidden_from_active == False, models.Task.status == "Done").all():
        if task.completed_at and task.completed_at < now - timedelta(hours=24):
            _hide(task, "done_24h")
            counts["tasks"] += 1

    for guest in db.query(models.GuestNote).filter(models.GuestNote.hidden_from_active == False, models.GuestNote.status == "Done").all():
        if guest.completed_at and guest.completed_at < now - timedelta(hours=48):
            _hide(guest, "resolved_48h")
            counts["guests"] += 1

    for fix in db.query(models.Fix).filter(models.Fix.hidden_from_active == False, models.Fix.status == "Verified").all():
        if fix.completed_at and fix.completed_at < now - timedelta(hours=24):
            _hide(fix, "verified_24h")
            counts["fixes"] += 1

    for approval in db.query(models.Approval).filter(models.Approval.hidden_from_active == False, models.Approval.status.in_(["Approved", "Rejected"])).all():
        _hide(approval, "decision_done")
        counts["approvals"] += 1

    for post in db.query(models.Post).filter(models.Post.hidden_from_active == False, models.Post.status == "Posted").all():
        if post.completed_at and post.completed_at < now - timedelta(hours=12):
            _hide(post, "posted")
            counts["posts"] += 1

    for memo in db.query(models.Memo).filter(models.Memo.hidden_from_active == False).all():
        if memo.expiry_date and memo.expiry_date < now:
            _hide(memo, "expired")
            counts["memos"] += 1

    for project in db.query(models.Project).filter(models.Project.hidden_from_active == False, models.Project.status == "Done").all():
        if project.completed_at and project.completed_at < now - timedelta(days=3):
            _hide(project, "done_3d")
            counts["projects"] += 1

    for note in db.query(models.ShiftNote).filter(models.ShiftNote.hidden_from_active == False, models.ShiftNote.status.in_(["Seen", "Done"])).all():
        if note.updated_at and note.updated_at < now - timedelta(hours=12):
            _hide(note, "seen_next_shift")
            counts["shift"] += 1

    db.commit()
    return counts
