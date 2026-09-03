import hashlib
import hmac
import json
import os
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..auth import normalize_email
from ..clock import utc_now
from ..database import get_db
from ..foundation_models import IntegrationEventInbox
from ..integration_models import ExternalUserIdentity, IntegrationDelivery
from .api import can_view_all, require_user


router = APIRouter(prefix="/api/integrations/v2", tags=["integrations-v2"])

SOURCE_EVENT_TYPES = {
    "hidden_oasis_staff_payroll": {
        "staff.operations.snapshot",
        "employee.status.changed",
        "attendance.exception.created",
        "ot.review.pending",
        "leave.request.pending",
        "cash_advance.request.pending",
        "payroll.ready_for_owner_review",
        "payroll.qa.warning",
        "annual_review.due",
        "memo.acknowledgment.pending",
        "task.submission.created",
        "shift.note.created",
        "fix.report.created",
        "guest.note.created",
    },
    "accounting_program": {
        "payroll_import.pending_review",
        "pos_sales_import.pending_review",
        "purchase_request.pending",
        "purchase_order.pending",
        "cash_advance_accounting.pending",
        "drawer_reconciliation.pending",
        "payable.due",
        "receivable.issue",
        "journal_review.pending",
        "budget.variance.alert",
    },
    "dedicated_pos_cloud": {
        "daily_sales_context",
        "drawer_variance.alert",
        "room_charge.pending_frontdesk_post",
        "refund.review_needed",
        "void.review_needed",
        "open_orders.warning",
        "unpaid_orders.warning",
        "order.finalized",
        "payment.refunded",
        "order.voided",
        "cash_movement.created",
        "session.closed",
        "room_charge.request_created",
    },
    "inventory_procurement": {
        "inventory.exception.created",
        "stock.low.alert",
        "stockout.alert",
        "count.variance.pending_review",
        "transfer.pending_review",
        "requisition.pending_review",
        "purchase.need.created",
        "receiving.exception.created",
        "expiry.alert",
        "wastage.alert",
    },
}

SENSITIVE_KEYS = {
    "salary",
    "rate",
    "hourly_rate",
    "daily_rate",
    "declared_monthly_base",
    "gross_pay",
    "net_pay",
    "government_id",
    "sss_number",
    "philhealth_number",
    "pagibig_number",
    "tin",
    "private_hr_notes",
    "hr_notes",
    "notes_private",
    "annual_review_content",
    "memo_body",
    "payroll_lines",
    "benefits",
    "cash_advance_balance",
    "card_number",
    "pan",
    "cvv",
    "cvc",
    "bank_account",
    "account_number",
    "routing_number",
    "access_token",
    "refresh_token",
    "password",
    "secret",
    "api_key",
    # Narrative text supplied by source applications is not a safe replication
    # boundary. Operations retains structured operational facts and source links;
    # detailed narrative remains authoritative in the source application.
    "title",
    "summary",
    "note",
    "reason",
    "description",
    "details",
    "message",
    "privacy_note",
}
SENSITIVE_KEY_FRAGMENTS = (
    "salary",
    "government_id",
    "sss_number",
    "philhealth_number",
    "pagibig_number",
    "private_hr",
    "hr_notes",
    "memo_body",
    "card_number",
    "bank_account",
    "account_number",
    "routing_number",
    "access_token",
    "refresh_token",
    "password",
    "secret",
    "api_key",
)


class EventSubject(BaseModel):
    type: Optional[str] = None
    id: Optional[str] = None
    external_user_id: Optional[str] = None


class IntegrationEventEnvelope(BaseModel):
    event_id: Optional[str] = None
    external_id: Optional[str] = None
    event_type: str
    schema_version: int = Field(default=1, ge=1)
    occurred_at: Optional[datetime] = None
    correlation_id: Optional[str] = None
    subject: Optional[EventSubject] = None
    department_id: Optional[int] = None
    priority: str = "Normal"
    title: Optional[str] = None
    summary: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    def resolved_event_id(self) -> str:
        value = (self.event_id or self.external_id or "").strip()
        if not value:
            raise HTTPException(status_code=400, detail="event_id or external_id is required")
        return value


class IdentityLinkPayload(BaseModel):
    external_user_id: str
    operations_user_id: Optional[int] = None
    email: Optional[str] = None
    display_name: Optional[str] = None
    status: str = "active"


class IdentityLinkResponse(BaseModel):
    status: str
    source_app: str
    external_user_id: str
    operations_user_id: int


def _source_keys() -> Dict[str, str]:
    raw = os.getenv("INTEGRATION_API_KEYS_JSON", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=503, detail="INTEGRATION_API_KEYS_JSON is invalid") from exc
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=503, detail="INTEGRATION_API_KEYS_JSON must be an object")
        return {str(key): str(value) for key, value in parsed.items() if value}

    environment = os.getenv("ENVIRONMENT", "development").strip().lower()
    legacy = os.getenv("INTEGRATION_API_KEY", "").strip()
    if environment in {"prod", "production"} and legacy:
        raise HTTPException(
            status_code=503,
            detail="Production integrations require source-specific INTEGRATION_API_KEYS_JSON credentials",
        )
    return {source: legacy for source in SOURCE_EVENT_TYPES} if legacy else {}


def _authenticate_source(source_app: str, supplied_key: Optional[str]) -> None:
    if source_app not in SOURCE_EVENT_TYPES:
        raise HTTPException(status_code=404, detail="Unknown integration source")
    expected = _source_keys().get(source_app, "")
    if not expected:
        raise HTTPException(status_code=503, detail=f"No integration key configured for {source_app}")
    if not supplied_key or not hmac.compare_digest(supplied_key, expected):
        raise HTTPException(status_code=401, detail="Invalid integration API key")


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            normalized = str(key).strip().lower()
            if normalized in SENSITIVE_KEYS or any(token in normalized for token in SENSITIVE_KEY_FRAGMENTS):
                continue
            cleaned[key] = _scrub(item)
        return cleaned
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def _canonical_payload(event: IntegrationEventEnvelope) -> Dict[str, Any]:
    if hasattr(event, "model_dump"):
        data = event.model_dump(mode="json")
    else:
        data = json.loads(event.json())
    return _scrub(data)


def _payload_hash(payload: Dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _event_title(event: IntegrationEventEnvelope) -> str:
    return event.event_type.replace(".", " ").replace("_", " ").title()


def _event_summary(payload: Dict[str, Any]) -> str:
    body = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
    for key in ("counts", "totals"):
        value = body.get(key)
        if isinstance(value, dict):
            return ", ".join(f"{name}: {amount}" for name, amount in value.items())
    return ""


def _find_operations_user(db: Session, payload: IdentityLinkPayload) -> models.User:
    if payload.operations_user_id:
        user = db.get(models.User, payload.operations_user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Operations user not found")
        return user
    email = normalize_email(payload.email)
    if not email:
        raise HTTPException(
            status_code=409,
            detail="Provide operations_user_id or an email matching an existing Operations user",
        )
    user = db.query(models.User).filter(models.User.email.isnot(None)).all()
    match = next((item for item in user if normalize_email(item.email) == email), None)
    if not match:
        raise HTTPException(
            status_code=409,
            detail="No Operations user matches this email; create/link the operational user first",
        )
    return match


@router.post("/events/{source_app}")
def receive_event(
    source_app: str,
    event: IntegrationEventEnvelope,
    x_integration_api_key: Optional[str] = Header(default=None, alias="X-Integration-Api-Key"),
    db: Session = Depends(get_db),
):
    _authenticate_source(source_app, x_integration_api_key)
    if event.event_type not in SOURCE_EVENT_TYPES[source_app]:
        raise HTTPException(status_code=400, detail="Unsupported event_type for this source")

    event_id = event.resolved_event_id()
    payload = _canonical_payload(event)
    digest = _payload_hash(payload)

    existing = db.query(IntegrationDelivery).filter(
        IntegrationDelivery.source_app == source_app,
        IntegrationDelivery.event_id == event_id,
    ).first()
    if existing:
        if existing.payload_sha256 != digest:
            raise HTTPException(status_code=409, detail="event_id was already used with a different payload")
        return {"status": "already_applied", "delivery_id": existing.id}

    subject = event.subject
    delivery = IntegrationDelivery(
        source_app=source_app,
        event_id=event_id,
        event_type=event.event_type,
        schema_version=event.schema_version,
        correlation_id=event.correlation_id,
        subject_type=subject.type if subject else None,
        subject_id=subject.id if subject else None,
        status="received",
        payload_sha256=digest,
    )
    db.add(delivery)
    db.flush()

    db.add(
        IntegrationEventInbox(
            source_app=source_app,
            external_event_id=event_id,
            event_type=event.event_type,
            payload_json=json.dumps(payload, default=str),
            processed_at=utc_now(),
            attempts=1,
        )
    )

    review_item = models.ExternalReviewItem(
        external_source=source_app,
        external_id=event_id,
        event_type=event.event_type,
        source_app=source_app,
        source_record_type=subject.type if subject else None,
        source_record_id=subject.id if subject else None,
        department_id=event.department_id,
        title=_event_title(event),
        summary=_event_summary(payload),
        priority=event.priority or "Normal",
        status="For Review",
        payload_json=json.dumps(payload, default=str),
    )
    db.add(review_item)
    delivery.status = "processed"
    delivery.processed_at = utc_now()

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(IntegrationDelivery).filter(
            IntegrationDelivery.source_app == source_app,
            IntegrationDelivery.event_id == event_id,
        ).first()
        if existing and existing.payload_sha256 == digest:
            return {"status": "already_applied", "delivery_id": existing.id}
        raise HTTPException(status_code=409, detail="Integration event conflicts with an existing delivery")

    db.refresh(delivery)
    db.refresh(review_item)
    return {
        "status": "accepted",
        "delivery_id": delivery.id,
        "review_item_id": review_item.id,
        "schema_version": event.schema_version,
    }


@router.put("/identities/{source_app}", response_model=IdentityLinkResponse)
def link_identity(
    source_app: str,
    payload: IdentityLinkPayload,
    x_integration_api_key: Optional[str] = Header(default=None, alias="X-Integration-Api-Key"),
    db: Session = Depends(get_db),
):
    _authenticate_source(source_app, x_integration_api_key)
    external_user_id = payload.external_user_id.strip()
    if not external_user_id:
        raise HTTPException(status_code=400, detail="external_user_id is required")

    user = _find_operations_user(db, payload)
    row = db.query(ExternalUserIdentity).filter(
        ExternalUserIdentity.source_app == source_app,
        ExternalUserIdentity.external_user_id == external_user_id,
    ).first()
    result_status = "updated" if row else "created"
    if not row:
        row = ExternalUserIdentity(
            source_app=source_app,
            external_user_id=external_user_id,
            user_id=user.id,
        )
        db.add(row)
    row.user_id = user.id
    row.external_email = normalize_email(payload.email) or None
    row.external_name = payload.display_name
    row.status = payload.status or "active"
    row.last_seen_at = utc_now()
    db.commit()

    return IdentityLinkResponse(
        status=result_status,
        source_app=source_app,
        external_user_id=external_user_id,
        operations_user_id=user.id,
    )


@router.get("/identities")
def list_identities(
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if not can_view_all(user):
        raise HTTPException(status_code=403, detail="Manager access required")
    rows = db.query(ExternalUserIdentity).order_by(
        ExternalUserIdentity.source_app,
        ExternalUserIdentity.external_name,
        ExternalUserIdentity.external_user_id,
    ).all()
    return [
        {
            "id": row.id,
            "source_app": row.source_app,
            "external_user_id": row.external_user_id,
            "external_email": row.external_email,
            "external_name": row.external_name,
            "operations_user_id": row.user_id,
            "status": row.status,
            "last_seen_at": row.last_seen_at,
        }
        for row in rows
    ]


@router.get("/contract")
def integration_contract():
    return {
        "contract_version": 2,
        "sources": {source: sorted(events) for source, events in SOURCE_EVENT_TYPES.items()},
        "identity_rule": "One Operations user may map to one app-specific identifier per source app.",
        "idempotency_rule": "source_app + event_id is unique; replay with a changed payload is rejected.",
        "privacy_rule": "Operations stores structured operational facts only: sensitive identifiers, compensation, financial-account/credential fields, and untrusted narrative text are recursively stripped; detailed narrative remains in the source application.",
    }
