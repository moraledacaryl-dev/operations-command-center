from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..clock import utc_now
from ..utils import log_activity


def _lock_request(db: Session, request_id: int) -> models.Request:
    row = db.query(models.Request).filter(models.Request.id == request_id).with_for_update().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return row


def submit_request(db: Session, user: models.User, request_id: int, note: str | None = None):
    request = _lock_request(db, request_id)
    authorize_action(db, user, "requests", Action.TRANSITION, obj=request)
    if request.status != "Draft":
        raise HTTPException(status_code=409, detail="Only Draft requests can be submitted")
    if request.department_id is None:
        raise HTTPException(status_code=400, detail="Request requires a department before submission")
    # Resolve and validate existing Approval identity before changing Request
    # status. A stale/mismatched link must never be returned or reused.
    approvals = (
        db.query(models.Approval)
        .filter(
            models.Approval.source_type == "ops_need",
            models.Approval.source_id == request.id,
            models.Approval.status == "Pending",
            models.Approval.hidden_from_active == False,
        )
        .order_by(models.Approval.id.asc())
        .with_for_update()
        .limit(2)
        .all()
    )
    if len(approvals) > 1:
        raise HTTPException(status_code=409, detail="Multiple pending Approvals exist for this Request")
    approval = approvals[0] if approvals else None
    if approval is not None:
        authorize_action(db, user, "approvals", Action.VIEW, obj=approval)
        if approval.department_id != request.department_id:
            raise HTTPException(status_code=409, detail="Linked Approval department does not match Request")
    request.requested_by_id = request.requested_by_id or user.id
    request.status = "Review"
    if approval is None:
        approval = models.Approval(
            title=request.title,
            source_type="ops_need",
            source_id=request.id,
            requested_by_id=user.id,
            department_id=request.department_id,
            status="Pending",
            priority=request.urgency or "Normal",
            note=(note or request.reason or request.note),
        )
        db.add(approval)
        db.flush()
        log_activity(db, "approvals", approval.id, "created", f"Approval created for request #{request.id}", actor_id=user.id)
    log_activity(db, "requests", request.id, "submitted", f"Submitted for approval #{approval.id}", actor_id=user.id)
    db.commit()
    db.refresh(request)
    db.refresh(approval)
    return request, approval


def plan_request(db: Session, user: models.User, request_id: int, note: str | None = None):
    request = _lock_request(db, request_id)
    authorize_action(db, user, "requests", Action.TRANSITION, obj=request)
    if request.status != "Approved":
        raise HTTPException(status_code=409, detail="Only Approved requests can be planned")

    task = None
    if request.linked_task_id is not None:
        task = (
            db.query(models.Task)
            .filter(models.Task.id == request.linked_task_id)
            .with_for_update()
            .one_or_none()
        )
        if task is None:
            raise HTTPException(status_code=409, detail="Linked Task no longer exists")
        authorize_action(db, user, "tasks", Action.VIEW, obj=task)
        if task.department_id != request.department_id:
            raise HTTPException(status_code=409, detail="Linked Task department does not match Request")
    if task is None:
        authorize_action(db, user, "tasks", Action.CREATE, department_id=request.department_id)
        task = models.Task(
            title=request.title,
            department_id=request.department_id,
            status="To Do",
            priority=request.urgency or "Normal",
            note=(note or f"Approved request #{request.id}.\n\n{request.reason or request.note or ''}"),
        )
        db.add(task)
        db.flush()
        request.linked_task_id = task.id
        log_activity(db, "tasks", task.id, "created", f"Created from approved request #{request.id}", actor_id=user.id)
    request.status = "Planned"
    log_activity(db, "requests", request.id, "planned", f"Planned with task #{task.id}", actor_id=user.id)
    db.commit()
    db.refresh(request)
    db.refresh(task)
    return request, task


def complete_request(db: Session, user: models.User, request_id: int, note: str | None = None):
    request = _lock_request(db, request_id)
    authorize_action(db, user, "requests", Action.TRANSITION, obj=request)
    if request.status != "Planned":
        raise HTTPException(status_code=409, detail="Only Planned requests can be completed")
    request.status = "Done"
    request.completed_at = utc_now()
    if note:
        request.note = f"{request.note or ''}\n\nCompletion: {note}".strip()
    log_activity(db, "requests", request.id, "completed", note or "Request completed", actor_id=user.id)
    db.commit()
    db.refresh(request)
    return request
