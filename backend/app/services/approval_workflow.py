from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..clock import utc_now
from ..utils import log_activity


def _locked_approval(db: Session, approval_id: int) -> models.Approval:
    row = db.query(models.Approval).filter(models.Approval.id == approval_id).with_for_update().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Approval not found")
    return row


def decide_approval(db: Session, user: models.User, approval_id: int, decision: str, note: str | None = None):
    if decision not in {"Approved", "Rejected"}:
        raise HTTPException(status_code=400, detail="Decision must be Approved or Rejected")
    if decision == "Rejected" and not (note or "").strip():
        raise HTTPException(status_code=400, detail="Rejection note is required")

    approval = _locked_approval(db, approval_id)
    authorize_action(db, user, "approvals", Action.DECIDE, obj=approval)
    if approval.status != "Pending":
        raise HTTPException(status_code=409, detail="Approval has already been decided")

    now = utc_now()
    approval.status = decision
    approval.decided_by_id = user.id
    approval.decided_at = now
    approval.decision_note = (note or "").strip() or None
    approval.completed_at = now

    request = None
    external_item = None
    if approval.source_type == "ops_need" and approval.source_id:
        request = db.query(models.Request).filter(models.Request.id == approval.source_id).with_for_update().one_or_none()
        if request is None:
            raise HTTPException(status_code=409, detail="Linked Request no longer exists")
        authorize_action(db, user, "requests", Action.VIEW, obj=request)
        if request.status != "Review":
            raise HTTPException(status_code=409, detail="Linked Request is not awaiting approval")
        request.status = decision
        request.decision = approval.decision_note
        if decision == "Rejected":
            request.completed_at = now
        log_activity(db, "requests", request.id, "decision", f"Request {decision}", actor_id=user.id, metadata={"note": approval.decision_note})

    if approval.source_type == "external_review_item" and approval.source_id:
        external_item = db.query(models.ExternalReviewItem).filter(models.ExternalReviewItem.id == approval.source_id).with_for_update().one_or_none()
        if external_item is None:
            raise HTTPException(status_code=409, detail="Linked external review item no longer exists")
        authorize_action(db, user, "external-review-items", Action.VIEW, obj=external_item)
        external_item.status = decision
        if approval.decision_note:
            external_item.summary = f"{external_item.summary or ''}\n\nDecision: {approval.decision_note}".strip()
        log_activity(db, "external-review-items", external_item.id, "decision", f"External review item {decision}", actor_id=user.id, metadata={"note": approval.decision_note})

    log_activity(db, "approvals", approval.id, "decision", f"Approval {decision}", actor_id=user.id, metadata={"note": approval.decision_note})
    db.commit()
    db.refresh(approval)
    if request is not None:
        db.refresh(request)
    if external_item is not None:
        db.refresh(external_item)
    return approval, request, external_item
