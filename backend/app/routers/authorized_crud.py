from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, SYSTEM_OWNED_RESOURCES, authorize_action, scope_query
from ..clock import as_utc, utc_now
from ..database import get_db
from ..domain_values import WORKFLOW_RESOURCES
from ..pagination import cursor_page
from ..schemas.resources import validate_resource_payload
from ..services.operational_workflow import allowed_actions_for
from ..services.notifications import create_mentions, notify_user
from ..utils import apply_payload, log_activity, mark_completed_if_needed, model_to_dict, serialize_many
from .api import CommentPayload, StatusPayload, active_filter, apply_search, fetch_or_404, get_model, require_user

router = APIRouter(prefix="/api")

AUDIT_IDENTITY_FIELDS = {
    "requested_by_id", "submitted_by_id", "reported_by_id", "verified_by_id",
    "actor_id", "author_id", "uploaded_by_id", "decided_by_id", "reviewed_by_id",
    "seen_by_id", "seen_at",
}
DERIVED_CREATE_FIELDS = {
    "requests": "requested_by_id",
    "talk": "author_id",
    "shift-notes": "submitted_by_id",
    "fixes": "reported_by_id",
}
WORKFLOW_STATE_RESOURCES = WORKFLOW_RESOURCES
TASK_STATUS_ORDER = {"To Do": 0, "Doing": 1, "Review": 2, "Done": 3}

RESOURCE_URLS = {
    "tasks": "/tasks", "projects": "/projects", "requests": "/requests",
    "shift-notes": "/shift", "guests": "/guests", "fixes": "/fixes",
    "posts": "/posts", "approvals": "/approvals",
}


def _user_name(db: Session, user_id: int | None) -> str | None:
    candidate = db.get(models.User, user_id) if user_id else None
    return str(candidate.name) if candidate else None


def _enrich_people(db: Session, data: dict[str, Any]) -> dict[str, Any]:
    for field in (
        "requested_by_id", "submitted_by_id", "reported_by_id", "verified_by_id",
        "decided_by_id", "reviewed_by_id", "assigned_to_id", "owner_id", "author_id",
    ):
        if data.get(field):
            data[f"{field.removesuffix('_id')}_name"] = _user_name(db, int(data[field]))
    return data


def _reject_identity_fields(payload: dict[str, Any]) -> None:
    supplied = sorted(AUDIT_IDENTITY_FIELDS.intersection(payload))
    if supplied:
        raise HTTPException(status_code=400, detail=f"Audit identity fields are server-controlled: {', '.join(supplied)}")


def _validate_payload(resource: str, payload: dict[str, Any], *, patch: bool = False) -> dict[str, Any]:
    try:
        return validate_resource_payload(resource, payload, patch=patch)
    except KeyError:
        raise HTTPException(status_code=405, detail="This resource uses an explicit API contract.")
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc


def _department_id(payload: dict[str, Any], obj: Any = None) -> int | None:
    if "department_id" in payload:
        return payload.get("department_id")
    return getattr(obj, "department_id", None) if obj is not None else None


def _commit_or_conflict(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The requested change conflicts with an existing record or database constraint.",
        ) from exc


def _validate_task_transition(current: str, target: str) -> None:
    if current not in TASK_STATUS_ORDER or target not in TASK_STATUS_ORDER:
        raise HTTPException(status_code=422, detail="Unsupported Task status.")
    if TASK_STATUS_ORDER[target] < TASK_STATUS_ORDER[current]:
        raise HTTPException(status_code=409, detail="Task status cannot move backward. Use an explicit reopen action.")


@router.get("/{resource}")
def list_resource_authorized(
    resource: str,
    active: bool = Query(default=True),
    q: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    department_id: Optional[int] = Query(default=None),
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    paginated: bool = Query(default=False),
    cursor: Optional[str] = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    model = get_model(resource)
    authorize_action(db, user, resource, Action.VIEW, department_id=department_id)
    query = scope_query(db, user, model, db.query(model))
    query = active_filter(query, model, active)
    query = apply_search(query, model, resource, q)
    if status and hasattr(model, "status"):
        query = query.filter(getattr(model, "status") == status)
    if department_id and hasattr(model, "department_id"):
        query = query.filter(getattr(model, "department_id") == department_id)
    if paginated:
        return cursor_page(query, model, resource, min(limit, 100), cursor)
    if hasattr(model, "updated_at"):
        query = query.order_by(getattr(model, "updated_at").desc(), model.id.desc())
    return serialize_many(query.limit(limit).all())


@router.post("/{resource}")
def create_resource_authorized(
    resource: str,
    payload: dict[str, Any],
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    model = get_model(resource)
    if resource in SYSTEM_OWNED_RESOURCES:
        authorize_action(db, user, resource, Action.CREATE)
    _reject_identity_fields(payload)
    clean = _validate_payload(resource, payload)
    authorize_action(db, user, resource, Action.CREATE, department_id=clean.get("department_id"))
    obj = model()
    if resource == "requests":
        clean["status"] = "Draft"
    elif resource == "fixes":
        clean["status"] = "Open"
    derived_field = DERIVED_CREATE_FIELDS.get(resource)
    if derived_field and hasattr(obj, derived_field):
        clean[derived_field] = user.id
    apply_payload(obj, clean)
    db.add(obj)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The requested record conflicts with an existing record or database constraint.",
        ) from exc
    log_activity(db, resource, obj.id, "created", f"Created {resource}", actor_id=user.id)
    assigned_to_id = getattr(obj, "assigned_to_id", None)
    if assigned_to_id and int(assigned_to_id) != user.id:
        notify_user(db, assigned_to_id, "assignment", f"Assigned: {getattr(obj, 'title', resource)}", source_type=resource, source_id=obj.id, action_url=RESOURCE_URLS.get(resource))
    _commit_or_conflict(db)
    db.refresh(obj)
    return model_to_dict(obj)


@router.get("/{resource}/{item_id}")
def get_resource_authorized(resource: str, item_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    authorize_action(db, user, resource, Action.VIEW, obj=obj)
    data = _enrich_people(db, model_to_dict(obj))
    comment_rows = db.query(models.Comment).filter(models.Comment.parent_type == resource, models.Comment.parent_id == item_id).order_by(models.Comment.created_at.desc()).all()
    data["comments"] = [_enrich_people(db, model_to_dict(row)) for row in comment_rows]
    data["attachments"] = serialize_many(db.query(models.Attachment).filter(models.Attachment.parent_type == resource, models.Attachment.parent_id == item_id).order_by(models.Attachment.created_at.desc()).all())
    activity_rows = db.query(models.ActivityLog).filter(models.ActivityLog.entity_type == resource, models.ActivityLog.entity_id == item_id).order_by(models.ActivityLog.created_at.desc()).limit(30).all()
    data["activity"] = [{**model_to_dict(row), "actor_name": _user_name(db, row.actor_id)} for row in activity_rows]
    data["allowed_actions"] = allowed_actions_for(db, user, resource, obj)
    return data


@router.patch("/{resource}/{item_id}")
def update_resource_authorized(
    resource: str,
    item_id: int,
    payload: dict[str, Any],
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    previous_assignee = getattr(obj, "assigned_to_id", None)
    expected_updated_at = payload.pop("expected_updated_at", None)
    _reject_identity_fields(payload)
    if expected_updated_at and hasattr(obj, "updated_at"):
        try:
            expected = as_utc(datetime.fromisoformat(str(expected_updated_at).replace("Z", "+00:00")))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Invalid record version timestamp.")
        if as_utc(obj.updated_at) != expected:
            raise HTTPException(status_code=409, detail="This record changed after you opened it. Refresh before saving.")
    if resource in WORKFLOW_STATE_RESOURCES and "status" in payload:
        raise HTTPException(status_code=405, detail="Use the canonical workflow endpoint.")
    clean = _validate_payload(resource, payload, patch=True)
    authorize_action(db, user, resource, Action.EDIT, obj=obj, department_id=_department_id(clean, obj))
    apply_payload(obj, clean, excluded={"id", "created_at", "updated_at"} | AUDIT_IDENTITY_FIELDS)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The requested change conflicts with an existing record or database constraint.",
        ) from exc
    log_activity(db, resource, obj.id, "updated", f"Updated {resource}", actor_id=user.id)
    next_assignee = getattr(obj, "assigned_to_id", None)
    if next_assignee and next_assignee != previous_assignee and int(next_assignee) != user.id:
        notify_user(db, next_assignee, "assignment", f"Assigned: {getattr(obj, 'title', resource)}", source_type=resource, source_id=obj.id, action_url=RESOURCE_URLS.get(resource))
    _commit_or_conflict(db)
    db.refresh(obj)
    return model_to_dict(obj)


@router.post("/{resource}/{item_id}/status")
def set_status_authorized(resource: str, item_id: int, payload: StatusPayload, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    if resource in WORKFLOW_STATE_RESOURCES:
        raise HTTPException(status_code=405, detail="Use the canonical workflow endpoint.")
    authorize_action(db, user, resource, Action.TRANSITION, obj=obj)
    if not hasattr(obj, "status") and not hasattr(obj, "review_status"):
        raise HTTPException(status_code=400, detail="Resource has no status")
    target_field = "status" if hasattr(obj, "status") else "review_status"
    setattr(obj, target_field, payload.status)
    mark_completed_if_needed(obj, payload.status)
    log_activity(db, resource, obj.id, "status", f"Status → {payload.status}", actor_id=user.id, metadata={"note": payload.note})
    _commit_or_conflict(db)
    db.refresh(obj)
    return model_to_dict(obj)


@router.post("/{resource}/{item_id}/archive")
def archive_resource_authorized(resource: str, item_id: int, reason: str = "manual", user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    authorize_action(db, user, resource, Action.ARCHIVE, obj=obj)
    if not hasattr(obj, "hidden_from_active"):
        raise HTTPException(status_code=400, detail="Resource cannot be archived")
    obj.hidden_from_active = True
    obj.archived_at = utc_now()
    obj.archive_reason = reason
    log_activity(db, resource, obj.id, "archived", reason, actor_id=user.id)
    _commit_or_conflict(db)
    db.refresh(obj)
    return model_to_dict(obj)


@router.post("/{resource}/{item_id}/comments")
def add_comment_authorized(resource: str, item_id: int, payload: CommentPayload, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    authorize_action(db, user, resource, Action.COMMENT, obj=obj)
    comment = models.Comment(parent_type=resource, parent_id=item_id, body=payload.body, author_id=user.id, comment_type=payload.comment_type)
    db.add(comment)
    create_mentions(db, payload.body, mentioned_by_id=user.id, parent_type=resource, parent_id=item_id, action_url=RESOURCE_URLS.get(resource))
    log_activity(db, resource, item_id, "comment", payload.body[:120], actor_id=user.id)
    _commit_or_conflict(db)
    db.refresh(comment)
    return model_to_dict(comment)


@router.get("/{resource}/{item_id}/comments")
def comments_authorized(resource: str, item_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    authorize_action(db, user, resource, Action.VIEW, obj=obj)
    return serialize_many(db.query(models.Comment).filter(models.Comment.parent_type == resource, models.Comment.parent_id == item_id).order_by(models.Comment.created_at.desc()).all())
