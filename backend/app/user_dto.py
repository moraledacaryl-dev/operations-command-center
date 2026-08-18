from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel
from sqlalchemy.orm import Session

from . import models
from .capabilities import capability_payload


class DepartmentMembershipResponse(BaseModel):
    id: int
    name: str
    is_primary: bool
    role_override: str | None = None


class OperationalUserResponse(BaseModel):
    id: int
    name: str
    role: str
    department_id: int | None = None
    primary_department_id: int | None = None
    departments: list[DepartmentMembershipResponse]


class AdminUserResponse(OperationalUserResponse):
    email: str | None = None
    is_active: bool
    last_login_at: datetime | None = None
    password_set_at: datetime | None = None


class CurrentUserResponse(AdminUserResponse):
    capabilities: dict[str, bool]


def department_memberships(db: Session, user: models.User) -> list[DepartmentMembershipResponse]:
    rows = []
    memberships = (
        db.query(models.UserDepartment)
        .filter(models.UserDepartment.user_id == user.id)
        .all()
    )
    if not memberships and user.department_id:
        department = db.get(models.Department, user.department_id)
        if department:
            rows.append(
                DepartmentMembershipResponse(
                    id=department.id,
                    name=department.name,
                    is_primary=True,
                    role_override=None,
                )
            )
    else:
        for membership in memberships:
            department = db.get(models.Department, membership.department_id)
            if department:
                rows.append(
                    DepartmentMembershipResponse(
                        id=department.id,
                        name=department.name,
                        is_primary=membership.is_primary,
                        role_override=membership.role_override,
                    )
                )
    rows.sort(key=lambda row: (not row.is_primary, row.name))
    return rows


def operational_user(db: Session, user: models.User) -> OperationalUserResponse:
    departments = department_memberships(db, user)
    primary_department_id = next(
        (department.id for department in departments if department.is_primary),
        user.department_id,
    )
    return OperationalUserResponse(
        id=user.id,
        name=user.name,
        role=user.role,
        department_id=user.department_id,
        primary_department_id=primary_department_id,
        departments=departments,
    )


def admin_user(db: Session, user: models.User) -> AdminUserResponse:
    base = operational_user(db, user)
    return AdminUserResponse(
        **base.model_dump(),
        email=user.email,
        is_active=bool(user.is_active),
        last_login_at=user.last_login_at,
        password_set_at=user.password_set_at,
    )


def current_user(db: Session, user: models.User) -> CurrentUserResponse:
    base = admin_user(db, user)
    return CurrentUserResponse(
        **base.model_dump(),
        capabilities=capability_payload(user.role),
    )
