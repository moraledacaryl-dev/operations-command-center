from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from .api import require_integration_key, scrub_payload

router = APIRouter(prefix="/api/integrations/staff", tags=["staff-integrations"])

REVIEW_EVENTS = {
    "schedule.week.published",
    "schedule.week.republished",
    "leave.request.submitted",
    "leave.request.approved",
    "leave.request.rejected",
    "leave.request.cancelled",
    "attendance.exception.opened",
    "attendance.exception.resolved",
    "overtime.approval.pending",
    "overtime.approved",
    "annual_review.due",
    "staff.operations.snapshot",
    "payroll.ready_for_owner_review",
    "employee.status.changed",
    "attendance.exception.created",
    "ot.review.pending",
    "leave.request.pending",
    "cash_advance.request.pending",
    "payroll.qa.warning",
    "memo.acknowledgment.pending",
}


def _validate_envelope(payload: dict[str, Any]) -> None:
    missing = [key for key in ("external_source", "external_id", "event_type") if not payload.get(key)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")
    if payload.get("external_source") != "hidden_oasis_staff_payroll":
        raise HTTPException(status_code=422, detail="Unsupported integration source")


def _employee_summary(payload: dict[str, Any]) -> str:
    body = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
    employees = body.get("employees") if isinstance(body.get("employees"), list) else []
    active = sum(1 for row in employees if isinstance(row, dict) and row.get("active"))
    return f"{len(employees)} employee reference(s), {active} active"


def _store(db: Session, payload: dict[str, Any], *, title: str, summary: str, status: str) -> dict[str, Any]:
    existing = db.query(models.ExternalReviewItem).filter(
        models.ExternalReviewItem.external_source == payload["external_source"],
        models.ExternalReviewItem.external_id == payload["external_id"],
    ).first()
    if existing:
        return {"status": "already_applied", "id": existing.id}
    clean = scrub_payload(payload)
    item = models.ExternalReviewItem(
        external_source=payload["external_source"],
        external_id=payload["external_id"],
        event_type=payload["event_type"],
        source_app="hidden_oasis_staff_payroll",
        source_record_type=str(payload.get("source_record_type") or ""),
        source_record_id=str(payload.get("source_record_id") or ""),
        department_id=payload.get("department_id"),
        title=title,
        summary=summary,
        priority=str(payload.get("priority") or "Normal"),
        status=status,
        payload_json=json.dumps(clean, default=str),
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(models.ExternalReviewItem).filter(
            models.ExternalReviewItem.external_source == payload["external_source"],
            models.ExternalReviewItem.external_id == payload["external_id"],
        ).first()
        return {"status": "already_applied", "id": existing.id if existing else None}
    db.refresh(item)
    return {"status": "accepted", "id": item.id}


@router.post("/events")
def receive_staff_event(
    payload: dict[str, Any],
    db: Session = Depends(get_db),
    _: None = Depends(require_integration_key),
) -> dict[str, Any]:
    _validate_envelope(payload)
    event_type = str(payload["event_type"])
    if event_type == "employee.sync":
        return _store(
            db,
            payload,
            title="Staff employee references synchronized",
            summary=_employee_summary(payload),
            status="Reference",
        )
    if event_type not in REVIEW_EVENTS:
        raise HTTPException(status_code=422, detail="Unsupported Staff event type")
    body = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
    return _store(
        db,
        payload,
        title=event_type.replace(".", " ").title(),
        summary=str(body.get("summary") or "Staff operational event"),
        status="For Review",
    )
