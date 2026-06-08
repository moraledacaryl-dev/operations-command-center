import base64
import hashlib
import hmac
import json
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, inspect
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models
from ..utils import apply_payload, log_activity, mark_completed_if_needed, model_to_dict, serialize_many
from ..auto_archive import run_auto_archive

router = APIRouter(prefix="/api")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SESSION_SECRET = os.getenv("SESSION_SECRET", "local-command-center-secret")
TOKEN_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", str(60 * 60 * 24 * 14)))

RESOURCE_MODELS = {
    "departments": models.Department,
    "users": models.User,
    "user-departments": models.UserDepartment,
    "rooms": models.RoomArea,
    "requests": models.Request,
    "talk": models.TalkMessage,
    "docs": models.DepartmentDoc,
    "routines": models.RoutineTemplate,
    "projects": models.Project,
    "tasks": models.Task,
    "shift-notes": models.ShiftNote,
    "guests": models.GuestNote,
    "fixes": models.Fix,
    "posts": models.Post,
    "approvals": models.Approval,
    "memos": models.Memo,
    "submissions": models.Submission,
    "external-review-items": models.ExternalReviewItem,
}

SEARCH_COLUMNS = {
    "departments": ["name", "short_name"],
    "users": ["name", "email", "role"],
    "user-departments": ["role_override"],
    "rooms": ["name", "kind", "note"],
    "requests": ["title", "request_type", "urgency", "status", "reason", "decision", "note"],
    "talk": ["body", "message_type", "status"],
    "docs": ["title", "doc_type", "body", "status"],
    "routines": ["title", "frequency", "checklist", "status", "priority"],
    "projects": ["title", "note", "status", "priority"],
    "tasks": ["title", "note", "status", "priority"],
    "shift-notes": ["title", "note", "category", "shift", "status"],
    "guests": ["title", "guest_name", "issue_type", "note", "action_taken"],
    "fixes": ["title", "problem", "note", "status"],
    "posts": ["title", "platform", "content_type", "caption", "campaign", "status"],
    "approvals": ["title", "source_type", "status", "decision_note", "note"],
    "memos": ["title", "message", "status"],
    "submissions": ["title", "source_app", "source_type", "review_status", "payload_json", "note"],
    "external-review-items": ["title", "source_app", "event_type", "status", "summary", "payload_json"],
}


class LoginPayload(BaseModel):
    email: str
    password: str = ""

class Payload(BaseModel):
    data: Dict[str, Any]

class StatusPayload(BaseModel):
    status: str
    actor_id: Optional[int] = None
    note: Optional[str] = None

class CommentPayload(BaseModel):
    body: str
    author_id: Optional[int] = None
    comment_type: str = "General"

class ApprovalPayload(BaseModel):
    status: str
    decided_by_id: Optional[int] = None
    decision_note: Optional[str] = None

class WorkflowPayload(BaseModel):
    note: Optional[str] = None
    department_id: Optional[int] = None
    create_task: bool = False
    proof_url: Optional[str] = None
    filename: Optional[str] = None


STAFF_EVENTS = {
    "staff.operations.snapshot",
    "payroll.ready_for_owner_review",
    "employee.status.changed",
    "attendance.exception.created",
    "ot.review.pending",
    "leave.request.pending",
    "cash_advance.request.pending",
    "payroll.qa.warning",
    "annual_review.due",
    "memo.acknowledgment.pending",
}
ACCOUNTING_EVENTS = {
    "payroll_import.pending_review",
    "pos_sales_import.pending_review",
    "purchase_request.pending",
    "purchase_order.pending",
    "cash_advance_accounting.pending",
    "drawer_reconciliation.pending",
    "payable.due",
    "receivable.issue",
    "journal_review.pending",
}
POS_EVENTS = {
    "daily_sales_context",
    "drawer_variance.alert",
    "room_charge.pending_frontdesk_post",
    "refund.review_needed",
    "void.review_needed",
    "open_orders.warning",
    "unpaid_orders.warning",
}
SENSITIVE_KEYS = {
    "salary", "rate", "hourly_rate", "daily_rate", "declared_monthly_base", "gross_pay", "net_pay",
    "government_id", "sss_number", "philhealth_number", "pagibig_number", "tin", "infractions",
    "annual_reviews", "annual_review_content", "hr_notes", "private_hr_notes", "notes_private", "memo_body",
    "benefits", "payroll_lines", "cash_advance_balance",
}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign_token(payload: Dict[str, Any]) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":"), default=str).encode())
    signature = hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(signature)}"


def verify_token(token: str) -> Dict[str, Any]:
    try:
        body, signature = token.split(".", 1)
        expected = _b64(hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        payload = json.loads(_unb64(body))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid session")
    if payload.get("exp", 0) < int(time.time()):
        raise HTTPException(status_code=401, detail="Session expired")
    return payload


def require_user(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing session")
    payload = verify_token(authorization.removeprefix("Bearer ").strip())
    user = db.get(models.User, int(payload.get("sub", 0)))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid session user")
    return user


def can_view_all(user: models.User) -> bool:
    return user.role in ["owner", "admin", "manager"]


def department_ids_for(db: Session, user: models.User) -> set[int]:
    ids = {row.department_id for row in db.query(models.UserDepartment).filter(models.UserDepartment.user_id == user.id).all()}
    if user.department_id:
        ids.add(user.department_id)
    return ids


def assert_department_access(db: Session, user: models.User, department_id: Optional[int]):
    if not department_id or can_view_all(user):
        return
    if int(department_id) not in department_ids_for(db, user):
        raise HTTPException(status_code=403, detail="No access to this department")


def assert_resource_access(db: Session, user: models.User, obj: Any):
    if can_view_all(user):
        return
    if hasattr(obj, "department_id"):
        assert_department_access(db, user, getattr(obj, "department_id", None))


def get_model(resource: str):
    model = RESOURCE_MODELS.get(resource)
    if not model:
        raise HTTPException(status_code=404, detail="Unknown resource")
    return model


def fetch_or_404(db: Session, model, item_id: int):
    obj = db.get(model, item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


def apply_search(query, model, resource: str, q: Optional[str]):
    if not q:
        return query
    terms = []
    for col_name in SEARCH_COLUMNS.get(resource, []):
        if hasattr(model, col_name):
            terms.append(getattr(model, col_name).ilike(f"%{q}%"))
    if terms:
        query = query.filter(or_(*terms))
    return query




def user_departments(db: Session, user: models.User):
    memberships = db.query(models.UserDepartment).filter(models.UserDepartment.user_id == user.id).all()
    if not memberships and user.department_id:
        dept = db.get(models.Department, user.department_id)
        return [{"id": dept.id, "name": dept.name, "short_name": dept.short_name, "is_primary": True, "role_override": None}] if dept else []
    rows = []
    for membership in memberships:
        dept = db.get(models.Department, membership.department_id)
        if dept:
            rows.append({
                "id": dept.id,
                "name": dept.name,
                "short_name": dept.short_name,
                "is_primary": membership.is_primary,
                "role_override": membership.role_override,
            })
    rows.sort(key=lambda x: (not x["is_primary"], x["name"]))
    return rows

def serialize_user(db: Session, user: models.User):
    data = model_to_dict(user)
    data["departments"] = user_departments(db, user)
    data["primary_department_id"] = data["departments"][0]["id"] if data["departments"] else user.department_id
    data["can_view_all"] = user.role in ["owner", "admin", "manager"]
    return data

def active_filter(query, model, active: bool):
    if active and hasattr(model, "hidden_from_active"):
        query = query.filter(model.hidden_from_active == False)
    return query


def create_followup_task(
    db: Session,
    user: models.User,
    title: str,
    department_id: Optional[int],
    priority: str = "Normal",
    note: str = "",
    **links,
):
    assert_department_access(db, user, department_id)
    task = models.Task(
        title=title,
        department_id=department_id,
        priority=priority or "Normal",
        status="To Do",
        note=note,
        **{key: value for key, value in links.items() if value},
    )
    db.add(task)
    db.flush()
    log_activity(db, "tasks", task.id, "created", "Created from workflow", actor_id=user.id, metadata=links)
    return task


def scrub_payload(value: Any) -> Any:
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            normalized = key.lower()
            if normalized in SENSITIVE_KEYS or any(token in normalized for token in ["salary", "government", "sss_number", "philhealth_number", "pagibig_number", "hourly_rate", "daily_rate"]):
                continue
            clean[key] = scrub_payload(item)
        return clean
    if isinstance(value, list):
        return [scrub_payload(item) for item in value]
    return value


def require_integration_event(payload: Dict[str, Any], allowed: set[str]):
    required = ["external_source", "external_id", "event_type"]
    missing = [field for field in required if not payload.get(field)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required fields: {', '.join(missing)}")
    if payload["event_type"] not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported event_type")


def item_title(payload: Dict[str, Any]) -> str:
    body = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
    if payload.get("event_type") == "staff.operations.snapshot":
        return "Staff operations snapshot"
    if payload.get("event_type") == "daily_sales_context":
        return f"POS daily context {body.get('business_date') or payload.get('business_date') or ''}".strip()
    return body.get("title") or payload.get("event_type", "External review item").replace(".", " ").title()


def item_summary(payload: Dict[str, Any]) -> str:
    body = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
    if isinstance(body.get("counts"), dict):
        return ", ".join(f"{key}: {value}" for key, value in body["counts"].items())
    if isinstance(body.get("totals"), dict):
        return ", ".join(f"{key}: {value}" for key, value in body["totals"].items())
    return body.get("summary") or body.get("privacy_note") or ""


def store_external_review_item(db: Session, payload: Dict[str, Any], allowed: set[str], source_app: str):
    require_integration_event(payload, allowed)
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
        source_app=source_app,
        source_record_type=str(payload.get("source_record_type") or ""),
        source_record_id=str(payload.get("source_record_id") or ""),
        department_id=payload.get("department_id"),
        title=item_title(clean),
        summary=item_summary(clean),
        priority=payload.get("priority") or "Normal",
        status=payload.get("status") or "For Review",
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


def overview_cards(db: Session):
    rows = db.query(models.ExternalReviewItem).filter(models.ExternalReviewItem.status != "Rejected").order_by(models.ExternalReviewItem.updated_at.desc()).limit(300).all()
    cards = {
        "staff": {},
        "pos": {},
        "accounting": {},
        "pending_review_count": 0,
    }
    for row in rows:
        payload = json.loads(row.payload_json or "{}")
        body = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
        if row.status in {"For Review", "Ready to Post"}:
            cards["pending_review_count"] += 1
        if row.event_type == "staff.operations.snapshot":
            cards["staff"].update(body.get("counts") or {})
        elif row.event_type == "daily_sales_context":
            cards["pos"].update({
                "sales": (body.get("totals") or {}).get("sales", 0),
                "orders": (body.get("totals") or {}).get("orders", 0),
                "pending_room_charges": (body.get("counts") or {}).get("pending_room_charges", 0),
                "drawer_variance": body.get("drawer_variance", 0),
            })
        elif row.source_app == "accounting_program":
            cards["accounting"][row.event_type] = cards["accounting"].get(row.event_type, 0) + 1
    return cards


def external_item_or_404(db: Session, item_id: int) -> models.ExternalReviewItem:
    return fetch_or_404(db, models.ExternalReviewItem, item_id)

@router.get("/health")
def health():
    return {"status": "ok", "app": "Manager Operations Command Center"}


@router.post("/integrations/staff/events")
async def receive_staff_event(payload: Dict[str, Any], db: Session = Depends(get_db)):
    return store_external_review_item(db, payload, STAFF_EVENTS, "hidden_oasis_staff_payroll")


@router.post("/integrations/accounting/status")
async def receive_accounting_status(payload: Dict[str, Any], db: Session = Depends(get_db)):
    return store_external_review_item(db, payload, ACCOUNTING_EVENTS, "accounting_program")


@router.post("/integrations/pos/status")
async def receive_pos_status(payload: Dict[str, Any], db: Session = Depends(get_db)):
    return store_external_review_item(db, payload, POS_EVENTS, "dedicated_pos_cloud")


@router.get("/integrations/overview")
async def integrations_overview(db: Session = Depends(get_db)):
    return overview_cards(db)


@router.post("/integrations/review-items/{item_id}/create-task")
async def create_task_from_external_item(
    item_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item = fetch_or_404(db, models.ExternalReviewItem, item_id)
    assert_department_access(db, user, item.department_id)
    task = create_followup_task(
        db,
        user,
        item.title,
        payload.department_id or item.department_id,
        item.priority,
        payload.note or item.summary or f"Created from external review item #{item.id}.",
    )
    item.linked_task_id = task.id
    item.status = "Ready to Post" if item.source_app == "accounting_program" else "In Progress"
    log_activity(db, "external-review-items", item.id, "created_task", f"Created task #{task.id}", actor_id=user.id)
    db.commit()
    db.refresh(task)
    return {"task": model_to_dict(task), "review_item": model_to_dict(item)}


@router.post("/integrations/review-items/{item_id}/mark-seen")
async def mark_external_item_seen(
    item_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item = external_item_or_404(db, item_id)
    assert_department_access(db, user, item.department_id)
    item.status = "Seen"
    if payload.note:
        item.summary = f"{item.summary or ''}\n\nManager note: {payload.note}".strip()
    log_activity(db, "external-review-items", item.id, "seen", payload.note or "Marked seen", actor_id=user.id)
    db.commit()
    return model_to_dict(item)


@router.post("/integrations/review-items/{item_id}/reject")
async def reject_external_item(
    item_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if not payload.note:
        raise HTTPException(status_code=400, detail="Rejection note is required")
    item = external_item_or_404(db, item_id)
    assert_department_access(db, user, item.department_id)
    item.status = "Rejected"
    item.summary = f"{item.summary or ''}\n\nRejected: {payload.note}".strip()
    log_activity(db, "external-review-items", item.id, "rejected", payload.note, actor_id=user.id)
    db.commit()
    return model_to_dict(item)


@router.post("/integrations/review-items/{item_id}/create-approval")
async def create_approval_from_external_item(
    item_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    item = external_item_or_404(db, item_id)
    department_id = payload.department_id or item.department_id
    assert_department_access(db, user, department_id)
    approval = models.Approval(
        title=item.title,
        source_type="external_review_item",
        source_id=item.id,
        requested_by_id=user.id,
        department_id=department_id,
        status="Pending",
        priority=item.priority or "Normal",
        note=payload.note or item.summary,
    )
    db.add(approval)
    db.flush()
    item.linked_approval_id = approval.id
    item.status = "Pending Approval"
    log_activity(db, "external-review-items", item.id, "created_approval", f"Created approval #{approval.id}", actor_id=user.id)
    db.commit()
    db.refresh(approval)
    return {"approval": model_to_dict(approval), "review_item": model_to_dict(item)}


@router.post("/auth/login")
def login(payload: LoginPayload, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email, models.User.is_active == True).first()
    # Starter-local login: seeded users use command123 unless production auth is replaced later.
    if not user or payload.password != "command123":
        raise HTTPException(status_code=401, detail="Invalid login")
    data = serialize_user(db, user)
    data["token"] = sign_token({"sub": user.id, "role": user.role, "exp": int(time.time()) + TOKEN_TTL_SECONDS})
    return data

@router.get("/auth/me")
def me(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return serialize_user(db, user)

@router.get("/meta")
def meta(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    users = db.query(models.User).filter(models.User.is_active == True).order_by(models.User.name).all()
    departments = db.query(models.Department).order_by(models.Department.name).all()
    if not can_view_all(user):
        allowed = department_ids_for(db, user)
        users = [candidate for candidate in users if candidate.id == user.id or department_ids_for(db, candidate).intersection(allowed)]
        departments = [dept for dept in departments if dept.id in allowed]
    return {
        "users": [serialize_user(db, user) for user in users],
        "departments": serialize_many(departments),
    }

@router.get("/departments/{department_id}/workspace")
def department_workspace(department_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    assert_department_access(db, user, department_id)
    dept = fetch_or_404(db, models.Department, department_id)
    return {
        "department": model_to_dict(dept),
        "people": [serialize_user(db, user) for user in db.query(models.User).filter(models.User.is_active == True).join(models.UserDepartment, models.UserDepartment.user_id == models.User.id).filter(models.UserDepartment.department_id == department_id).all()] or serialize_many(db.query(models.User).filter(models.User.department_id == department_id, models.User.is_active == True).all()),
        "tasks": serialize_many(db.query(models.Task).filter(models.Task.department_id == department_id, models.Task.hidden_from_active == False).order_by(models.Task.updated_at.desc()).limit(50).all()),
        "projects": serialize_many(db.query(models.Project).filter(models.Project.department_id == department_id, models.Project.hidden_from_active == False).order_by(models.Project.updated_at.desc()).limit(30).all()),
        "shift": serialize_many(db.query(models.ShiftNote).filter(models.ShiftNote.department_id == department_id, models.ShiftNote.hidden_from_active == False).order_by(models.ShiftNote.updated_at.desc()).limit(30).all()),
        "approvals": serialize_many(db.query(models.Approval).filter(models.Approval.department_id == department_id, models.Approval.hidden_from_active == False).order_by(models.Approval.updated_at.desc()).limit(30).all()),
        "requests": serialize_many(db.query(models.Request).filter(models.Request.department_id == department_id, models.Request.hidden_from_active == False).order_by(models.Request.updated_at.desc()).limit(30).all()),
        "talk": serialize_many(db.query(models.TalkMessage).filter(models.TalkMessage.department_id == department_id, models.TalkMessage.hidden_from_active == False).order_by(models.TalkMessage.updated_at.desc()).limit(30).all()),
        "docs": serialize_many(db.query(models.DepartmentDoc).filter(models.DepartmentDoc.department_id == department_id, models.DepartmentDoc.hidden_from_active == False).order_by(models.DepartmentDoc.updated_at.desc()).limit(30).all()),
        "routines": serialize_many(db.query(models.RoutineTemplate).filter(models.RoutineTemplate.department_id == department_id, models.RoutineTemplate.hidden_from_active == False).order_by(models.RoutineTemplate.updated_at.desc()).limit(30).all()),
        "history": history_search(q=None, kind=None, department_id=department_id, limit=60, user=user, db=db),
    }

@router.get("/dashboard")
def dashboard(department_id: Optional[int] = Query(default=None), user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    assert_department_access(db, user, department_id)
    def dq(model):
        q = db.query(model)
        if department_id and hasattr(model, "department_id"):
            q = q.filter(model.department_id == department_id)
        elif not can_view_all(user) and hasattr(model, "department_id"):
            q = q.filter(model.department_id.in_(department_ids_for(db, user)))
        return q
    counts = {
        "tasks": dq(models.Task).filter(models.Task.hidden_from_active == False).count(),
        "late": dq(models.Task).filter(models.Task.hidden_from_active == False, models.Task.due_date < datetime.utcnow(), models.Task.status != "Done").count(),
        "guests": dq(models.GuestNote).filter(models.GuestNote.hidden_from_active == False, models.GuestNote.status != "Done").count(),
        "fixes": dq(models.Fix).filter(models.Fix.hidden_from_active == False, models.Fix.status != "Verified").count(),
        "posts": dq(models.Post).filter(models.Post.hidden_from_active == False, models.Post.status.in_(["Review", "Fix"])).count(),
        "approve": dq(models.Approval).filter(models.Approval.hidden_from_active == False, models.Approval.status == "Pending").count(),
        "requests": dq(models.Request).filter(models.Request.hidden_from_active == False, models.Request.status.in_(["Review", "Draft", "Planned"])).count(),
    }
    focus = []
    focus += [("Task", x) for x in dq(models.Task).filter(models.Task.hidden_from_active == False, models.Task.priority == "Urgent").order_by(models.Task.updated_at.desc()).limit(3).all()]
    focus += [("Guest", x) for x in dq(models.GuestNote).filter(models.GuestNote.hidden_from_active == False, models.GuestNote.urgency == "Urgent").order_by(models.GuestNote.updated_at.desc()).limit(3).all()]
    focus += [("Fix", x) for x in dq(models.Fix).filter(models.Fix.hidden_from_active == False, models.Fix.urgency == "Urgent").order_by(models.Fix.updated_at.desc()).limit(3).all()]
    focus += [("Post", x) for x in dq(models.Post).filter(models.Post.hidden_from_active == False, models.Post.status == "Review").order_by(models.Post.updated_at.desc()).limit(3).all()]
    previous_shift = dq(models.ShiftNote).filter(models.ShiftNote.hidden_from_active == False, models.ShiftNote.status.in_(["New", "Follow"])).order_by(models.ShiftNote.created_at.desc()).limit(5).all()
    approvals = dq(models.Approval).filter(models.Approval.hidden_from_active == False, models.Approval.status == "Pending").order_by(models.Approval.created_at.desc()).limit(5).all()
    return {
        "counts": counts,
        "focus": [{"kind": kind, **model_to_dict(item)} for kind, item in focus[:8]],
        "previous_shift": serialize_many(previous_shift),
        "approvals": serialize_many(approvals),
    }


@router.post("/workflow/requests/{request_id}/submit-approval")
def workflow_submit_request(
    request_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    request = fetch_or_404(db, models.Request, request_id)
    assert_resource_access(db, user, request)
    department_id = request.department_id or payload.department_id
    assert_department_access(db, user, department_id)
    request.department_id = department_id
    request.requested_by_id = request.requested_by_id or user.id
    request.status = "Review"
    existing = db.query(models.Approval).filter(
        models.Approval.source_type == "ops_need",
        models.Approval.source_id == request.id,
        models.Approval.hidden_from_active == False,
        models.Approval.status == "Pending",
    ).first()
    approval = existing or models.Approval(
        title=request.title,
        source_type="ops_need",
        source_id=request.id,
        requested_by_id=user.id,
        department_id=department_id,
        status="Pending",
        priority=request.urgency or "Normal",
        note=payload.note or request.reason or request.note,
    )
    if not existing:
        db.add(approval)
        db.flush()
    log_activity(db, "requests", request.id, "submitted", f"Submitted for approval #{approval.id}", actor_id=user.id)
    log_activity(db, "approvals", approval.id, "created", f"Approval created for request #{request.id}", actor_id=user.id)
    db.commit()
    db.refresh(request)
    db.refresh(approval)
    return {"request": model_to_dict(request), "approval": model_to_dict(approval)}


@router.post("/workflow/approvals/{approval_id}/decide")
def workflow_decide_approval(
    approval_id: int,
    payload: WorkflowPayload,
    status: str = Query(...),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if status not in ["Approved", "Rejected"]:
        raise HTTPException(status_code=400, detail="Decision must be Approved or Rejected")
    approval = fetch_or_404(db, models.Approval, approval_id)
    assert_resource_access(db, user, approval)
    approval.status = status
    approval.decided_by_id = user.id
    approval.decided_at = datetime.utcnow()
    approval.decision_note = payload.note
    mark_completed_if_needed(approval, status)
    created_task = None
    if approval.source_type == "ops_need" and approval.source_id:
        request = db.get(models.Request, approval.source_id)
        if request:
            assert_resource_access(db, user, request)
            request.status = status
            request.decision = payload.note
            mark_completed_if_needed(request, status)
            log_activity(db, "requests", request.id, "decision", f"Request {status}", actor_id=user.id, metadata={"note": payload.note})
            if status == "Approved" and payload.create_task:
                request.status = "Planned"
                mark_completed_if_needed(request, "Planned")
                created_task = create_followup_task(
                    db,
                    user,
                    request.title,
                    request.department_id or approval.department_id,
                    request.urgency or approval.priority or "Normal",
                    f"Approved request #{request.id}.\n\n{request.reason or request.note or ''}",
                )
                request.linked_task_id = created_task.id
    log_activity(db, "approvals", approval.id, "decision", f"Approval {status}", actor_id=user.id, metadata={"note": payload.note})
    db.commit()
    db.refresh(approval)
    return {"approval": model_to_dict(approval), "task": model_to_dict(created_task) if created_task else None}


@router.post("/workflow/guests/{guest_id}/create-fix")
def workflow_guest_create_fix(
    guest_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    guest = fetch_or_404(db, models.GuestNote, guest_id)
    assert_resource_access(db, user, guest)
    department_id = payload.department_id or guest.department_id
    assert_department_access(db, user, department_id)
    guest.department_id = guest.department_id or department_id
    fix = models.Fix(
        title=guest.title,
        department_id=department_id,
        room_area_id=guest.room_area_id,
        problem=payload.note or guest.note or guest.action_taken or guest.issue_type,
        urgency=guest.urgency or "Normal",
        status="Open",
        reported_by_id=user.id,
        linked_guest_note_id=guest.id,
        note=f"Created from guest note #{guest.id}.",
    )
    db.add(fix)
    db.flush()
    guest.linked_fix_id = fix.id
    guest.status = "Follow"
    log_activity(db, "guests", guest.id, "created_fix", f"Created fix #{fix.id}", actor_id=user.id)
    log_activity(db, "fixes", fix.id, "created", f"Created from guest note #{guest.id}", actor_id=user.id)
    db.commit()
    db.refresh(guest)
    db.refresh(fix)
    return {"guest": model_to_dict(guest), "fix": model_to_dict(fix)}


@router.post("/workflow/{resource}/{item_id}/create-task")
def workflow_create_task(
    resource: str,
    item_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    department_id = payload.department_id or getattr(obj, "department_id", None)
    assert_department_access(db, user, department_id)
    priority = getattr(obj, "priority", None) or getattr(obj, "urgency", None) or "Normal"
    link_fields = {
        "guests": {"linked_guest_note_id": item_id},
        "fixes": {"linked_fix_id": item_id},
        "posts": {"linked_post_id": item_id},
    }
    task = create_followup_task(
        db,
        user,
        getattr(obj, "title", None) or getattr(obj, "name", None) or f"Follow up {resource} #{item_id}",
        department_id,
        priority,
        payload.note or f"Created from {resource} #{item_id}.",
        **link_fields.get(resource, {}),
    )
    if hasattr(obj, "linked_task_id"):
        obj.linked_task_id = task.id
    log_activity(db, resource, item_id, "created_task", f"Created task #{task.id}", actor_id=user.id)
    db.commit()
    db.refresh(task)
    return {"task": model_to_dict(task)}


@router.post("/workflow/fixes/{fix_id}/verify")
def workflow_verify_fix(
    fix_id: int,
    payload: WorkflowPayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    fix = fetch_or_404(db, models.Fix, fix_id)
    assert_resource_access(db, user, fix)
    if not payload.note:
        raise HTTPException(status_code=400, detail="Verification note is required")
    fix.status = "Verified"
    fix.verified_at = datetime.utcnow()
    fix.verified_by_id = user.id
    mark_completed_if_needed(fix, "Verified")
    if fix.linked_guest_note_id:
        guest = db.get(models.GuestNote, fix.linked_guest_note_id)
        if guest:
            guest.status = "Done"
            guest.action_taken = payload.note
            mark_completed_if_needed(guest, "Done")
            log_activity(db, "guests", guest.id, "resolved", f"Resolved by fix #{fix.id}", actor_id=user.id)
    comment = models.Comment(parent_type="fixes", parent_id=fix.id, body=payload.note, author_id=user.id, comment_type="Verification")
    db.add(comment)
    if payload.proof_url:
        existing_attachment = db.query(models.Attachment).filter(
            models.Attachment.parent_type == "fixes",
            models.Attachment.parent_id == fix.id,
            models.Attachment.file_url == payload.proof_url,
        ).first()
        if not existing_attachment:
            db.add(models.Attachment(
                parent_type="fixes",
                parent_id=fix.id,
                filename=payload.filename or "Verification proof",
                file_url=payload.proof_url,
                uploaded_by_id=user.id,
            ))
    log_activity(db, "fixes", fix.id, "verified", "Fix verified", actor_id=user.id, metadata={"note": payload.note, "proof_url": payload.proof_url})
    db.commit()
    db.refresh(fix)
    return model_to_dict(fix)

@router.get("/{resource}")
def list_resource(
    resource: str,
    active: bool = Query(default=True),
    q: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    department_id: Optional[int] = Query(default=None),
    limit: int = Query(default=100, le=500),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    model = get_model(resource)
    if resource in ["users", "user-departments", "departments"] and not can_view_all(user):
        raise HTTPException(status_code=403, detail="Manager access required")
    assert_department_access(db, user, department_id)
    query = db.query(model)
    query = active_filter(query, model, active)
    query = apply_search(query, model, resource, q)
    if status and hasattr(model, "status"):
        query = query.filter(getattr(model, "status") == status)
    if department_id and hasattr(model, "department_id"):
        query = query.filter(getattr(model, "department_id") == department_id)
    elif not can_view_all(user) and hasattr(model, "department_id"):
        query = query.filter(getattr(model, "department_id").in_(department_ids_for(db, user)))
    if hasattr(model, "updated_at"):
        query = query.order_by(getattr(model, "updated_at").desc())
    return serialize_many(query.limit(limit).all())

@router.post("/{resource}")
def create_resource(resource: str, payload: Dict[str, Any], user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    if resource in ["users", "user-departments", "departments"] and not can_view_all(user):
        raise HTTPException(status_code=403, detail="Manager access required")
    assert_department_access(db, user, payload.get("department_id"))
    obj = model()
    apply_payload(obj, payload)
    db.add(obj)
    db.flush()
    log_activity(db, resource, obj.id, "created", f"Created {resource}", actor_id=user.id)
    db.commit()
    db.refresh(obj)
    return model_to_dict(obj)

@router.get("/{resource}/{item_id}")
def get_resource(resource: str, item_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    data = model_to_dict(obj)
    data["comments"] = serialize_many(db.query(models.Comment).filter(models.Comment.parent_type == resource, models.Comment.parent_id == item_id).order_by(models.Comment.created_at.desc()).all())
    data["attachments"] = serialize_many(db.query(models.Attachment).filter(models.Attachment.parent_type == resource, models.Attachment.parent_id == item_id).order_by(models.Attachment.created_at.desc()).all())
    data["activity"] = serialize_many(db.query(models.ActivityLog).filter(models.ActivityLog.entity_type == resource, models.ActivityLog.entity_id == item_id).order_by(models.ActivityLog.created_at.desc()).limit(30).all())
    return data

@router.patch("/{resource}/{item_id}")
def update_resource(resource: str, item_id: int, payload: Dict[str, Any], user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    assert_department_access(db, user, payload.get("department_id"))
    apply_payload(obj, payload)
    db.flush()
    log_activity(db, resource, obj.id, "updated", f"Updated {resource}", actor_id=user.id)
    db.commit()
    db.refresh(obj)
    return model_to_dict(obj)

@router.post("/{resource}/{item_id}/status")
def set_status(resource: str, item_id: int, payload: StatusPayload, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    if not hasattr(obj, "status") and not hasattr(obj, "review_status"):
        raise HTTPException(status_code=400, detail="Resource has no status")
    target_field = "status" if hasattr(obj, "status") else "review_status"
    setattr(obj, target_field, payload.status)
    mark_completed_if_needed(obj, payload.status)
    if isinstance(obj, models.Fix) and payload.status == "Verified":
        obj.verified_at = datetime.utcnow()
        obj.verified_by_id = payload.actor_id or user.id
    if isinstance(obj, models.Approval) and payload.status in ["Approved", "Rejected"]:
        obj.decided_at = datetime.utcnow()
        obj.decided_by_id = payload.actor_id or user.id
        if payload.note:
            obj.decision_note = payload.note
    log_activity(db, resource, obj.id, "status", f"Status → {payload.status}", actor_id=payload.actor_id or user.id, metadata={"note": payload.note})
    db.commit()
    db.refresh(obj)
    return model_to_dict(obj)

@router.post("/{resource}/{item_id}/archive")
def archive_resource(resource: str, item_id: int, reason: str = "manual", user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    if not hasattr(obj, "hidden_from_active"):
        raise HTTPException(status_code=400, detail="Resource cannot be archived")
    obj.hidden_from_active = True
    obj.archived_at = datetime.utcnow()
    obj.archive_reason = reason
    log_activity(db, resource, obj.id, "archived", reason, actor_id=user.id)
    db.commit()
    db.refresh(obj)
    return model_to_dict(obj)

@router.post("/{resource}/{item_id}/comments")
def add_comment(resource: str, item_id: int, payload: CommentPayload, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    comment = models.Comment(parent_type=resource, parent_id=item_id, body=payload.body, author_id=payload.author_id or user.id, comment_type=payload.comment_type)
    db.add(comment)
    log_activity(db, resource, item_id, "comment", payload.body[:120], actor_id=payload.author_id or user.id)
    db.commit()
    db.refresh(comment)
    return model_to_dict(comment)

@router.get("/{resource}/{item_id}/comments")
def comments(resource: str, item_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    return serialize_many(db.query(models.Comment).filter(models.Comment.parent_type == resource, models.Comment.parent_id == item_id).order_by(models.Comment.created_at.desc()).all())


@router.post("/{resource}/{item_id}/attachments")
def add_attachment(
    resource: str,
    item_id: int,
    filename: str = Form(default=""),
    file_url: str = Form(default=""),
    mime_type: str = Form(default=""),
    file: Optional[UploadFile] = File(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    assert_resource_access(db, user, obj)
    saved_url = file_url
    saved_filename = filename
    if file:
        safe_name = f"{resource}_{item_id}_{int(time.time())}_{file.filename}".replace("/", "_")
        target = UPLOAD_DIR / safe_name
        with target.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_url = f"/uploads/{safe_name}"
        saved_filename = file.filename
        mime_type = file.content_type or mime_type
    if not saved_url and not saved_filename:
        raise HTTPException(status_code=400, detail="Attachment needs a file or URL")
    attachment = models.Attachment(
        parent_type=resource,
        parent_id=item_id,
        filename=saved_filename or saved_url,
        file_url=saved_url,
        mime_type=mime_type or None,
        uploaded_by_id=user.id,
    )
    db.add(attachment)
    log_activity(db, resource, item_id, "attachment", f"Attached {attachment.filename}", actor_id=user.id)
    db.commit()
    db.refresh(attachment)
    return model_to_dict(attachment)

@router.post("/posts/{post_id}/versions")
def add_post_version(
    post_id: int,
    filename: str = Form(default=""),
    file_url: str = Form(default=""),
    caption_snapshot: str = Form(default=""),
    note: str = Form(default=""),
    uploaded_by_id: Optional[int] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    post = fetch_or_404(db, models.Post, post_id)
    assert_resource_access(db, user, post)
    existing = db.query(models.PostVersion).filter(models.PostVersion.post_id == post_id).count()
    version_no = existing + 1
    saved_url = file_url
    saved_filename = filename
    if file:
        safe_name = f"post_{post_id}_v{version_no}_{file.filename}".replace("/", "_")
        target = UPLOAD_DIR / safe_name
        with target.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_url = f"/uploads/{safe_name}"
        saved_filename = file.filename
    db.query(models.PostVersion).filter(models.PostVersion.post_id == post_id).update({"is_current": False})
    version = models.PostVersion(
        post_id=post_id,
        version_no=version_no,
        filename=saved_filename or f"Version {version_no}",
        file_url=saved_url,
        caption_snapshot=caption_snapshot or post.caption,
        note=note,
        uploaded_by_id=uploaded_by_id or user.id,
        is_current=True,
    )
    post.status = "Review"
    db.add(version)
    log_activity(db, "posts", post_id, "version", f"V{version_no} uploaded", actor_id=uploaded_by_id or user.id)
    db.commit()
    db.refresh(version)
    return model_to_dict(version)

@router.get("/posts/{post_id}/versions")
def list_post_versions(post_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    post = fetch_or_404(db, models.Post, post_id)
    assert_resource_access(db, user, post)
    return serialize_many(db.query(models.PostVersion).filter(models.PostVersion.post_id == post_id).order_by(models.PostVersion.version_no.desc()).all())

@router.get("/history/search/all")
def history_search(
    q: Optional[str] = None,
    kind: Optional[str] = None,
    department_id: Optional[int] = None,
    limit: int = 200,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    assert_department_access(db, user, department_id)
    resources = [kind] if kind else ["projects", "tasks", "shift-notes", "guests", "fixes", "posts", "requests", "approvals", "memos", "submissions", "talk", "docs", "routines"]
    results = []
    for resource in resources:
        model = RESOURCE_MODELS.get(resource)
        if not model or not hasattr(model, "hidden_from_active"):
            continue
        query = db.query(model).filter(model.hidden_from_active == True)
        if department_id and hasattr(model, "department_id"):
            query = query.filter(model.department_id == department_id)
        elif not can_view_all(user) and hasattr(model, "department_id"):
            query = query.filter(model.department_id.in_(department_ids_for(db, user)))
        query = apply_search(query, model, resource, q)
        if hasattr(model, "updated_at"):
            query = query.order_by(model.updated_at.desc())
        for item in query.limit(limit).all():
            data = model_to_dict(item)
            data["kind"] = resource
            results.append(data)
    return results[:limit]

@router.get("/rooms/{room_id}/memory")
def room_memory(room_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    room = fetch_or_404(db, models.RoomArea, room_id)
    guests = db.query(models.GuestNote).filter(models.GuestNote.room_area_id == room_id).order_by(models.GuestNote.updated_at.desc()).limit(50).all()
    fixes = db.query(models.Fix).filter(models.Fix.room_area_id == room_id).order_by(models.Fix.updated_at.desc()).limit(50).all()
    if not can_view_all(user):
        allowed = department_ids_for(db, user)
        guests = [guest for guest in guests if not hasattr(guest, "department_id") or not guest.department_id or guest.department_id in allowed]
        fixes = [fix for fix in fixes if not hasattr(fix, "department_id") or not fix.department_id or fix.department_id in allowed]
    return {"room": model_to_dict(room), "guests": serialize_many(guests), "fixes": serialize_many(fixes)}

@router.post("/routines/{routine_id}/generate-task")
def generate_routine_task(routine_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    routine = fetch_or_404(db, models.RoutineTemplate, routine_id)
    assert_resource_access(db, user, routine)
    today = datetime.utcnow().date().isoformat()
    existing = db.query(models.Task).filter(
        models.Task.department_id == routine.department_id,
        models.Task.title == routine.title,
        models.Task.hidden_from_active == False,
        models.Task.note.ilike(f"%Generated from routine {routine_id} on {today}%")
    ).first()
    if existing:
        return model_to_dict(existing)
    task = models.Task(
        title=routine.title,
        department_id=routine.department_id,
        assigned_to_id=routine.assigned_to_id,
        status="To Do",
        priority=routine.priority,
        note=f"Generated from routine {routine_id} on {today}.\n\nChecklist:\n{routine.checklist or ''}",
    )
    routine.last_generated_at = datetime.utcnow()
    db.add(task)
    db.flush()
    log_activity(db, "routines", routine.id, "generated", f"Generated task #{task.id}")
    log_activity(db, "tasks", task.id, "created", f"Created from routine #{routine.id}")
    db.commit()
    db.refresh(task)
    return model_to_dict(task)

@router.get("/review/queue")
def review_queue(department_id: Optional[int] = Query(default=None), user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    assert_department_access(db, user, department_id)
    def maybe_dept(q, model):
        if department_id and hasattr(model, "department_id"):
            return q.filter(model.department_id == department_id)
        if not can_view_all(user) and hasattr(model, "department_id"):
            return q.filter(model.department_id.in_(department_ids_for(db, user)))
        return q
    return {
        "submissions": serialize_many(db.query(models.Submission).filter(models.Submission.hidden_from_active == False, models.Submission.review_status.in_(["New", "Review"])).order_by(models.Submission.updated_at.desc()).limit(25).all()),
        "approvals": serialize_many(maybe_dept(db.query(models.Approval), models.Approval).filter(models.Approval.hidden_from_active == False, models.Approval.status == "Pending").order_by(models.Approval.updated_at.desc()).limit(25).all()),
        "requests": serialize_many(maybe_dept(db.query(models.Request), models.Request).filter(models.Request.hidden_from_active == False, models.Request.status.in_(["Draft", "Review", "Planned"])).order_by(models.Request.updated_at.desc()).limit(25).all()),
        "posts": serialize_many(maybe_dept(db.query(models.Post), models.Post).filter(models.Post.hidden_from_active == False, models.Post.status.in_(["Review", "Fix"])).order_by(models.Post.updated_at.desc()).limit(25).all()),
        "fixes": serialize_many(maybe_dept(db.query(models.Fix), models.Fix).filter(models.Fix.hidden_from_active == False, models.Fix.status == "Done").order_by(models.Fix.updated_at.desc()).limit(25).all()),
        "external": serialize_many(maybe_dept(db.query(models.ExternalReviewItem), models.ExternalReviewItem).filter(models.ExternalReviewItem.status.in_(["For Review", "Ready to Post", "Seen", "Pending Approval", "In Progress"])).order_by(models.ExternalReviewItem.updated_at.desc()).limit(50).all()),
    }

@router.post("/auto-archive/run")
def run_archive(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    if not can_view_all(user):
        raise HTTPException(status_code=403, detail="Manager access required")
    return run_auto_archive(db)
