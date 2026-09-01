from __future__ import annotations

import time
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .. import models
from ..auth import hash_password, normalize_email, verify_password
from ..authorization_policy import department_ids_for
from ..clock import utc_now
from ..capabilities import has_capability
from ..database import get_db
from ..pagination import cursor_page
from ..session_security import revoke_user_sessions
from ..user_dto import AdminUserResponse, CurrentUserResponse, admin_user, current_user, operational_user
from ..utils import log_activity, model_to_dict, serialize_many
from .api import (
    AdminUserCreatePayload,
    LoginPayload,
    TOKEN_TTL_SECONDS,
    active_filter,
    apply_search,
    find_user_by_email,
    overview_cards,
    require_user,
    sign_token,
    validate_password_or_400,
)

router = APIRouter(prefix="/api")

ACCOUNT_ROLES = {"owner", "admin", "manager", "lead", "supervisor", "staff"}


class AdminUserUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=160)
    role: str | None = None
    is_active: bool | None = None


class MembershipUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_primary: bool | None = None
    role_override: str | None = Field(default=None, max_length=40)


def require_capability(user: models.User, capability: str) -> None:
    if not has_capability(user.role, capability):
        raise HTTPException(status_code=403, detail="You do not have permission to complete this action.")


@router.post("/auth/login")
def login(payload: LoginPayload, db: Session = Depends(get_db)):
    user = find_user_by_email(db, payload.email)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid login")
    if not user.password_hash:
        raise HTTPException(status_code=403, detail="Password is not set for this account yet.")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid login")
    user.last_login_at = utc_now()
    db.commit()
    data = current_user(db, user).model_dump(mode="json")
    data["token"] = sign_token(
        {"sub": user.id, "role": user.role, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    )
    return data


@router.get("/auth/me", response_model=CurrentUserResponse)
def me(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return current_user(db, user)


@router.get("/users", response_model=list[AdminUserResponse])
def users(
    active: bool = Query(default=True),
    q: Optional[str] = Query(default=None),
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(user, "view_sensitive_user_metadata")
    query = db.query(models.User)
    if active:
        query = query.filter(models.User.is_active == True)
    query = apply_search(query, models.User, "users", q)
    query = query.order_by(models.User.updated_at.desc())
    return [admin_user(db, candidate) for candidate in query.limit(limit).all()]


@router.get("/users/page")
def users_page(
    active: bool = Query(default=True),
    q: Optional[str] = Query(default=None),
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: Optional[str] = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(user, "view_sensitive_user_metadata")
    query = db.query(models.User)
    if active:
        query = query.filter(models.User.is_active == True)
    query = apply_search(query, models.User, "users", q)
    page = cursor_page(query, models.User, "users", limit, cursor)
    page["items"] = [admin_user(db, db.get(models.User, item["id"])).model_dump(mode="json") for item in page["items"]]
    return page


@router.post("/admin/users", response_model=AdminUserResponse)
def create_user(
    payload: AdminUserCreatePayload,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(user, "manage_accounts")
    validate_password_or_400(payload.password)
    email = normalize_email(payload.email)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")
    if find_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="A user with that email already exists.")
    new_user = models.User(
        name=name,
        email=email,
        role=(payload.role or "manager").strip() or "manager",
        department_id=payload.department_id,
        is_active=bool(payload.is_active),
        password_hash=hash_password(payload.password),
        password_set_at=utc_now(),
    )
    db.add(new_user)
    db.flush()
    if payload.department_id:
        db.add(
            models.UserDepartment(
                user_id=new_user.id,
                department_id=payload.department_id,
                is_primary=True,
            )
        )
    log_activity(db, "users", new_user.id, "created", "Created user with password auth", actor_id=user.id)
    db.commit()
    db.refresh(new_user)
    return admin_user(db, new_user)


def _ensure_owner_survives(db: Session, target: models.User, next_role: str | None, next_active: bool | None) -> None:
    removes_owner = target.role == "owner" and (next_role not in {None, "owner"} or next_active is False)
    if not removes_owner:
        return
    other_owners = db.query(models.User).filter(
        models.User.id != target.id,
        models.User.role == "owner",
        models.User.is_active == True,
    ).count()
    if other_owners == 0:
        raise HTTPException(status_code=409, detail="At least one active owner account is required.")


@router.patch("/admin/users/{user_id}", response_model=AdminUserResponse)
def update_user(
    user_id: int,
    payload: AdminUserUpdatePayload,
    actor: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(actor, "manage_accounts")
    target = db.get(models.User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")
    data = payload.model_dump(exclude_unset=True)
    if "role" in data:
        data["role"] = str(data["role"] or "").strip().lower()
        if data["role"] not in ACCOUNT_ROLES:
            raise HTTPException(status_code=422, detail="Unsupported account role.")
    if "email" in data:
        data["email"] = normalize_email(data["email"])
        if not data["email"]:
            raise HTTPException(status_code=422, detail="Email is required.")
        duplicate = db.query(models.User).filter(models.User.id != target.id, models.User.email == data["email"]).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="A user with that email already exists.")
    if "name" in data:
        data["name"] = str(data["name"] or "").strip()
    _ensure_owner_survives(db, target, data.get("role"), data.get("is_active"))
    security_changed = any(key in data and data[key] != getattr(target, key) for key in {"role", "is_active"})
    for key, value in data.items():
        setattr(target, key, value)
    log_activity(db, "users", target.id, "updated", "Account profile or access state updated", actor_id=actor.id)
    db.commit()
    if security_changed:
        revoke_user_sessions(db, target.id)
    db.refresh(target)
    return admin_user(db, target)


@router.patch("/admin/user-departments/{membership_id}")
def update_membership(
    membership_id: int,
    payload: MembershipUpdatePayload,
    actor: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(actor, "manage_accounts")
    membership = db.get(models.UserDepartment, membership_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Department membership not found.")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        db.query(models.UserDepartment).filter(
            models.UserDepartment.user_id == membership.user_id,
            models.UserDepartment.id != membership.id,
        ).update({models.UserDepartment.is_primary: False}, synchronize_session=False)
        target = db.get(models.User, membership.user_id)
        if target:
            target.department_id = membership.department_id
    for key, value in data.items():
        setattr(membership, key, value)
    log_activity(db, "user-departments", membership.id, "updated", "Department membership updated", actor_id=actor.id)
    db.commit()
    revoke_user_sessions(db, membership.user_id)
    db.refresh(membership)
    return model_to_dict(membership)


@router.delete("/admin/user-departments/{membership_id}", status_code=204)
def delete_membership(
    membership_id: int,
    actor: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(actor, "manage_accounts")
    membership = db.get(models.UserDepartment, membership_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Department membership not found.")
    user_id = membership.user_id
    was_primary = membership.is_primary
    db.delete(membership)
    db.flush()
    if was_primary:
        replacement = db.query(models.UserDepartment).filter(models.UserDepartment.user_id == user_id).order_by(models.UserDepartment.id).first()
        target = db.get(models.User, user_id)
        if replacement:
            replacement.is_primary = True
            if target:
                target.department_id = replacement.department_id
        elif target:
            target.department_id = None
    log_activity(db, "user-departments", membership_id, "deleted", "Department membership removed", actor_id=actor.id)
    db.commit()
    revoke_user_sessions(db, user_id)
    return Response(status_code=204)


@router.get("/departments/{department_id}/workspace")
def department_workspace(
    department_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if not has_capability(user.role, "view_all_operations") and department_id not in department_ids_for(db, user):
        raise HTTPException(status_code=403, detail="No access to this department")
    department = db.get(models.Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Not found")
    people = (
        db.query(models.User)
        .filter(models.User.is_active == True)
        .join(models.UserDepartment, models.UserDepartment.user_id == models.User.id)
        .filter(models.UserDepartment.department_id == department_id)
        .all()
    )
    if not people:
        people = (
            db.query(models.User)
            .filter(models.User.department_id == department_id, models.User.is_active == True)
            .all()
        )
    active_models = {
        "tasks": models.Task,
        "projects": models.Project,
        "shift": models.ShiftNote,
        "approvals": models.Approval,
        "requests": models.Request,
        "talk": models.TalkMessage,
        "docs": models.DepartmentDoc,
        "routines": models.RoutineTemplate,
    }
    aggregate_counts = {
        key: db.query(model).filter(model.department_id == department_id, model.hidden_from_active == False).count()
        for key, model in active_models.items()
    }
    aggregate_counts["urgent_tasks"] = db.query(models.Task).filter(
        models.Task.department_id == department_id,
        models.Task.hidden_from_active == False,
        models.Task.priority.in_(["Urgent", "High"]),
    ).count()
    return {
        "department": model_to_dict(department),
        "aggregate_counts": aggregate_counts,
        "preview_limits": {"tasks": 50, **{key: 30 for key in active_models if key != "tasks"}},
        "people": [operational_user(db, candidate).model_dump(mode="json") for candidate in people],
        "tasks": serialize_many(db.query(models.Task).filter(models.Task.department_id == department_id, models.Task.hidden_from_active == False).order_by(models.Task.updated_at.desc()).limit(50).all()),
        "projects": serialize_many(db.query(models.Project).filter(models.Project.department_id == department_id, models.Project.hidden_from_active == False).order_by(models.Project.updated_at.desc()).limit(30).all()),
        "shift": serialize_many(db.query(models.ShiftNote).filter(models.ShiftNote.department_id == department_id, models.ShiftNote.hidden_from_active == False).order_by(models.ShiftNote.updated_at.desc()).limit(30).all()),
        "approvals": serialize_many(db.query(models.Approval).filter(models.Approval.department_id == department_id, models.Approval.hidden_from_active == False).order_by(models.Approval.updated_at.desc()).limit(30).all()),
        "requests": serialize_many(db.query(models.Request).filter(models.Request.department_id == department_id, models.Request.hidden_from_active == False).order_by(models.Request.updated_at.desc()).limit(30).all()),
        "talk": serialize_many(db.query(models.TalkMessage).filter(models.TalkMessage.department_id == department_id, models.TalkMessage.hidden_from_active == False).order_by(models.TalkMessage.updated_at.desc()).limit(30).all()),
        "docs": serialize_many(db.query(models.DepartmentDoc).filter(models.DepartmentDoc.department_id == department_id, models.DepartmentDoc.hidden_from_active == False).order_by(models.DepartmentDoc.updated_at.desc()).limit(30).all()),
        "routines": serialize_many(db.query(models.RoutineTemplate).filter(models.RoutineTemplate.department_id == department_id, models.RoutineTemplate.hidden_from_active == False).order_by(models.RoutineTemplate.updated_at.desc()).limit(30).all()),
    }


@router.get("/integrations/overview")
def integrations_overview(
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(user, "view_integration_summary")
    return overview_cards(db)
