from __future__ import annotations

from enum import StrEnum
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Query, Session

from . import models
from .capabilities import has_capability, normalize_role


class Action(StrEnum):
    VIEW = "view"
    CREATE = "create"
    EDIT = "edit"
    TRANSITION = "transition"
    ARCHIVE = "archive"
    COMMENT = "comment"
    ATTACH = "attach"
    DECIDE = "decide"


SYSTEM_OWNED_RESOURCES = {
    "approvals",
    "external-review-items",
    "submissions",
}

# Owner/Admin are the only principals allowed to treat an unassigned department
# record as organization-wide for mutations. Managers keep view_all_operations
# for reads, but manage_department does not itself grant cross-department writes.
EXECUTIVE_MUTATION_ROLES = {"owner", "admin"}

DEPARTMENT_SCOPED_RESOURCES = {
    "requests",
    "talk",
    "docs",
    "routines",
    "projects",
    "tasks",
    "shift-notes",
    "guests",
    "fixes",
    "posts",
    "approvals",
    "memos",
    "external-review-items",
}

RESOURCE_ACTION_CAPABILITIES: dict[str, dict[Action, str | None]] = {
    "users": {
        Action.VIEW: "view_sensitive_user_metadata",
        Action.CREATE: "manage_accounts",
        Action.EDIT: "manage_accounts",
        Action.ARCHIVE: "manage_accounts",
    },
    "user-departments": {
        Action.VIEW: "manage_accounts",
        Action.CREATE: "manage_accounts",
        Action.EDIT: "manage_accounts",
        Action.ARCHIVE: "manage_accounts",
    },
    "departments": {
        Action.VIEW: "view_all_operations",
        Action.CREATE: "manage_system",
        Action.EDIT: "manage_system",
        Action.ARCHIVE: "manage_system",
    },
    "approvals": {
        Action.VIEW: None,
        Action.DECIDE: "make_decisions",
        Action.COMMENT: None,
    },
}

for _resource in (
    "rooms",
    "requests",
    "talk",
    "docs",
    "routines",
    "projects",
    "tasks",
    "shift-notes",
    "guests",
    "fixes",
    "posts",
    "memos",
):
    RESOURCE_ACTION_CAPABILITIES.setdefault(
        _resource,
        {
            Action.VIEW: None,
            Action.CREATE: "manage_department",
            Action.EDIT: "manage_department",
            Action.TRANSITION: "manage_department",
            Action.ARCHIVE: "manage_department",
            Action.COMMENT: None,
            Action.ATTACH: "manage_department",
        },
    )

for _resource in SYSTEM_OWNED_RESOURCES:
    RESOURCE_ACTION_CAPABILITIES.setdefault(
        _resource,
        {
            Action.VIEW: None,
            Action.COMMENT: None,
        },
    )

MODEL_RESOURCE_NAMES = {
    models.Department: "departments",
    models.User: "users",
    models.UserDepartment: "user-departments",
    models.RoomArea: "rooms",
    models.Request: "requests",
    models.TalkMessage: "talk",
    models.DepartmentDoc: "docs",
    models.RoutineTemplate: "routines",
    models.Project: "projects",
    models.Task: "tasks",
    models.ShiftNote: "shift-notes",
    models.GuestNote: "guests",
    models.Fix: "fixes",
    models.Post: "posts",
    models.Approval: "approvals",
    models.Memo: "memos",
    models.Submission: "submissions",
    models.ExternalReviewItem: "external-review-items",
}


def can_mutate_globally(user: models.User) -> bool:
    return normalize_role(user.role) in EXECUTIVE_MUTATION_ROLES


def department_ids_for(db: Session, user: models.User) -> set[int]:
    ids = {
        row.department_id
        for row in db.query(models.UserDepartment)
        .filter(models.UserDepartment.user_id == user.id)
        .all()
    }
    if user.department_id:
        ids.add(int(user.department_id))
    return ids


def _canonical_department_id(obj: Any = None, department_id: int | None = None) -> int | None:
    if department_id is not None:
        return int(department_id)
    if obj is not None and hasattr(obj, "department_id"):
        value = getattr(obj, "department_id", None)
        return int(value) if value is not None else None
    return None


def _deny(detail: str = "You do not have permission to complete this action.") -> None:
    raise HTTPException(status_code=403, detail=detail)


def authorize_action(
    db: Session,
    user: models.User,
    resource: str,
    action: Action,
    obj: Any = None,
    department_id: int | None = None,
) -> None:
    if resource not in RESOURCE_ACTION_CAPABILITIES:
        raise HTTPException(status_code=404, detail="Unknown resource")

    if resource in SYSTEM_OWNED_RESOURCES and action in {
        Action.CREATE,
        Action.EDIT,
        Action.TRANSITION,
        Action.ARCHIVE,
        Action.ATTACH,
    }:
        raise HTTPException(status_code=405, detail="Use the canonical workflow endpoint.")

    permissions = RESOURCE_ACTION_CAPABILITIES[resource]
    if action not in permissions:
        _deny()
    required = permissions[action]
    if required and not has_capability(user.role, required):
        _deny()

    target_department_id = _canonical_department_id(obj=obj, department_id=department_id)
    if resource in DEPARTMENT_SCOPED_RESOURCES:
        if action == Action.VIEW and has_capability(user.role, "view_all_operations"):
            return
        if action != Action.VIEW and can_mutate_globally(user):
            return
        if target_department_id is None:
            _deny("A department scope is required for this resource.")
        if target_department_id not in department_ids_for(db, user):
            _deny("No access to this department.")


def scope_query(db: Session, user: models.User, model: type, query: Query):
    resource = MODEL_RESOURCE_NAMES.get(model)
    if not resource:
        return query

    required = RESOURCE_ACTION_CAPABILITIES.get(resource, {}).get(Action.VIEW)
    if required and not has_capability(user.role, required):
        _deny()

    if resource in DEPARTMENT_SCOPED_RESOURCES and hasattr(model, "department_id"):
        if has_capability(user.role, "view_all_operations"):
            return query
        ids = department_ids_for(db, user)
        if not ids:
            return query.filter(False)
        return query.filter(model.department_id.in_(ids))
    return query
