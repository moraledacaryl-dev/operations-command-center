from __future__ import annotations

import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models
from ..auth import hash_password, normalize_email, verify_password
from ..authorization_policy import department_ids_for
from ..capabilities import has_capability
from ..database import get_db
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
    user.last_login_at = datetime.utcnow()
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
    limit: int = Query(default=100, le=500),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(user, "view_sensitive_user_metadata")
    query = db.query(models.User)
    query = active_filter(query, models.User, active)
    query = apply_search(query, models.User, "users", q)
    query = query.order_by(models.User.updated_at.desc())
    return [admin_user(db, candidate) for candidate in query.limit(limit).all()]


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
        password_set_at=datetime.utcnow(),
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
    return {
        "department": model_to_dict(department),
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
