"""Idempotent, scoped reminders for overdue mandatory reading.

Runs from a single systemd timer. Row locks protect against accidental overlap.
"""
from datetime import timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from ..clock import utc_now
from ..staff_guide_models import (
    GuideDocument, GuideRevision, GuideRevisionDepartment,
    GuideReading, GuideAcknowledgment,
)
from ..staff_guide_service import can_view_revision, eligible_users
from .notifications import notify_user


def assign_new_readers(db: Session, now) -> int:
    published = (db.query(GuideDocument, GuideRevision)
        .join(GuideRevision, GuideDocument.current_revision_id == GuideRevision.id)
        .filter(GuideDocument.retired_at.is_(None),
                GuideRevision.requires_ack.is_(True)).all())
    added = 0
    for doc, revision in published:
        departments = [row.department_id for row in
                       db.query(GuideRevisionDepartment).filter_by(revision_id=revision.id).all()]
        existing = {user_id for (user_id,) in db.query(GuideReading.user_id)
                    .filter_by(revision_id=revision.id).all()}
        for person in eligible_users(db, revision, departments):
            if person.id in existing:
                continue
            db.add(GuideReading(user_id=person.id, revision_id=revision.id,
                                assigned_at=now, due_at=now + timedelta(days=7)))
            notify_user(db, person.id, "staff-guide",
                        "Required reading: " + revision.title,
                        "A published guide applies to your department. Please read and confirm.",
                        source_type="staff-guide", source_id=doc.id,
                        action_url="/staff-guide?doc=" + str(doc.id))
            existing.add(person.id)
            added += 1
    db.flush()
    return added


def send_due_reminders(db: Session, now=None) -> int:
    now = now or utc_now()
    assign_new_readers(db, now)
    cutoff = now - timedelta(days=3)
    rows = (db.query(GuideReading, GuideDocument, GuideRevision)
        .join(GuideRevision, GuideRevision.id == GuideReading.revision_id)
        .join(GuideDocument, GuideDocument.id == GuideRevision.document_id)
        .outerjoin(GuideAcknowledgment,
                   (GuideAcknowledgment.revision_id == GuideReading.revision_id) &
                   (GuideAcknowledgment.user_id == GuideReading.user_id))
        .filter(
            GuideReading.due_at <= now,
            or_(GuideReading.last_reminded_at.is_(None),
                GuideReading.last_reminded_at <= cutoff),
            GuideAcknowledgment.id.is_(None),
            GuideDocument.current_revision_id == GuideRevision.id,
            GuideDocument.retired_at.is_(None),
        )
        .order_by(GuideReading.id)
        .limit(500)
        .with_for_update(of=GuideReading, skip_locked=True)
        .all())
    created = 0
    for reading, doc, revision in rows:
        person = db.get(models.User, reading.user_id)
        if not person or not person.is_active or not can_view_revision(db, person, doc.id):
            continue
        notify_user(
            db, person.id, "staff-guide-reminder",
            "Reading due: " + revision.title,
            "Please open the Staff Guide and confirm you have read this policy.",
            source_type="staff-guide", source_id=doc.id,
            action_url="/staff-guide?doc=" + str(doc.id), priority="High",
        )
        reading.last_reminded_at = now
        created += 1
    db.commit()
    return created
