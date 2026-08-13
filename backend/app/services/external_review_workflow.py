from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..capabilities import has_capability
from ..utils import log_activity

TERMINAL_STATES = {"Approved", "Rejected"}


def _lock_item(db: Session, item_id: int) -> models.ExternalReviewItem:
    row = db.query(models.ExternalReviewItem).filter(models.ExternalReviewItem.id == item_id).with_for_update().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="External review item not found")
    return row


def mark_seen(db: Session, user: models.User, item_id: int, note: str | None = None):
    item = _lock_item(db, item_id)
    authorize_action(db, user, "external-review-items", Action.VIEW, obj=item)
    if item.status in TERMINAL_STATES or item.status in {"In Progress", "Pending Approval"}:
        raise HTTPException(status_code=409, detail="External review item cannot regress to Seen")
    if item.status == "For Review":
        item.status = "Seen"
    if note:
        item.summary = f"{item.summary or ''}\n\nManager note: {note}".strip()
    log_activity(db, "external-review-items", item.id, "seen", note or "Marked seen", actor_id=user.id)
    db.commit()
    db.refresh(item)
    return item


def create_task(db: Session, user: models.User, item_id: int, department_id: int | None = None, note: str | None = None):
    item = _lock_item(db, item_id)
    authorize_action(db, user, "external-review-items", Action.VIEW, obj=item)
    target_department = department_id or item.department_id
    authorize_action(db, user, "tasks", Action.CREATE, department_id=target_department)
    if item.status in TERMINAL_STATES or item.status == "Pending Approval":
        raise HTTPException(status_code=409, detail="External review item cannot create a task in its current state")
    if item.linked_task_id:
        existing = db.get(models.Task, item.linked_task_id)
        if existing is not None:
            return existing, item
    task = models.Task(
        title=item.title,
        department_id=target_department,
        priority=item.priority or "Normal",
        status="To Do",
        note=note or item.summary or f"Created from external review item #{item.id}.",
    )
    db.add(task)
    db.flush()
    item.linked_task_id = task.id
    item.status = "In Progress"
    log_activity(db, "tasks", task.id, "created", f"Created from external review item #{item.id}", actor_id=user.id)
    log_activity(db, "external-review-items", item.id, "created_task", f"Created task #{task.id}", actor_id=user.id)
    db.commit()
    db.refresh(task)
    db.refresh(item)
    return task, item


def create_approval(db: Session, user: models.User, item_id: int, department_id: int | None = None, note: str | None = None):
    item = _lock_item(db, item_id)
    authorize_action(db, user, "external-review-items", Action.VIEW, obj=item)
    if not has_capability(user.role, "manage_approvals"):
        raise HTTPException(status_code=403, detail="Approval-management authority is required")
    target_department = department_id or item.department_id
    if item.status in TERMINAL_STATES:
        raise HTTPException(status_code=409, detail="Terminal external review item cannot create an Approval")
    if item.linked_approval_id:
        existing = db.get(models.Approval, item.linked_approval_id)
        if existing is not None:
            return existing, item
    approval = models.Approval(
        title=item.title,
        source_type="external_review_item",
        source_id=item.id,
        requested_by_id=user.id,
        department_id=target_department,
        status="Pending",
        priority=item.priority or "Normal",
        note=note or item.summary,
    )
    db.add(approval)
    db.flush()
    item.linked_approval_id = approval.id
    item.status = "Pending Approval"
    log_activity(db, "external-review-items", item.id, "created_approval", f"Created approval #{approval.id}", actor_id=user.id)
    db.commit()
    db.refresh(approval)
    db.refresh(item)
    return approval, item


def reject_item(db: Session, user: models.User, item_id: int, note: str | None):
    if not (note or "").strip():
        raise HTTPException(status_code=400, detail="Rejection note is required")
    item = _lock_item(db, item_id)
    authorize_action(db, user, "external-review-items", Action.VIEW, obj=item)
    if not has_capability(user.role, "make_decisions"):
        raise HTTPException(status_code=403, detail="Decision authority is required")
    if item.status in TERMINAL_STATES:
        raise HTTPException(status_code=409, detail="External review item is already terminal")
    if item.status == "Pending Approval":
        raise HTTPException(status_code=409, detail="Decide the linked Approval instead")
    item.status = "Rejected"
    item.summary = f"{item.summary or ''}\n\nRejected: {note.strip()}".strip()
    log_activity(db, "external-review-items", item.id, "rejected", note.strip(), actor_id=user.id)
    db.commit()
    db.refresh(item)
    return item
