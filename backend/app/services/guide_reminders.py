"""Idempotent, scoped reminders for overdue mandatory reading.

Runs from a single systemd timer. Row locks protect against accidental overlap.
"""
from datetime import timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from ..clock import utc_now
from ..staff_guide_models import (
    GuideDocument, GuideRevision, GuideReading, GuideAcknowledgment,
)
from ..staff_guide_service import can_view_revision
from .notifications import notify_user


def send_due_reminders(db: Session, now=None) -> int:
    now = now or utc_now()
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
