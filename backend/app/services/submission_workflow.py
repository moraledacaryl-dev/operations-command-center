from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..utils import log_activity

ALLOWED_DECISIONS = {"Accepted", "Rejected"}


def decide_submission(
    db: Session,
    user: models.User,
    submission_id: int,
    status: str,
    note: str | None = None,
) -> models.Submission:
    decision = str(status or "").strip().title()
    if decision not in ALLOWED_DECISIONS:
        raise HTTPException(status_code=422, detail="Submission decision must be Accepted or Rejected.")
    decision_note = (note or "").strip()
    if decision == "Rejected" and not decision_note:
        raise HTTPException(status_code=400, detail="A rejection note is required.")

    submission = (
        db.query(models.Submission)
        .filter(models.Submission.id == submission_id)
        .with_for_update()
        .first()
    )
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    authorize_action(db, user, "submissions", Action.DECIDE, obj=submission)

    if submission.review_status != "New":
        raise HTTPException(status_code=409, detail="This submission has already been decided.")

    now = datetime.utcnow()
    submission.review_status = decision
    submission.reviewed_by_id = user.id
    submission.reviewed_at = now
    if decision_note:
        submission.note = decision_note

    log_activity(
        db,
        "submissions",
        submission.id,
        "decision",
        f"Submission {decision.lower()}",
        actor_id=user.id,
        metadata={"status": decision, "note": decision_note or None},
    )
    db.commit()
    db.refresh(submission)
    return submission
