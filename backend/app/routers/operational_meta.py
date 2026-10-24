from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..user_dto import DepartmentMembershipResponse, operational_user
from ..utils import serialize_many
from .api import can_view_all, department_ids_for, require_user

router = APIRouter(prefix="/api")


@router.get("/meta")
def operational_meta(
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    users = db.query(models.User).filter(models.User.is_active == True).order_by(models.User.name).all()
    departments = db.query(models.Department).order_by(models.Department.name).all()
    department_map = {department.id: department for department in departments}
    memberships: dict[int, list[models.UserDepartment]] = {person.id: [] for person in users}
    for membership in db.query(models.UserDepartment).filter(models.UserDepartment.user_id.in_(memberships)).all():
        memberships[membership.user_id].append(membership)

    if not can_view_all(user):
        allowed = department_ids_for(db, user)
        users = [
            candidate
            for candidate in users
            if candidate.id == user.id or (
                {membership.department_id for membership in memberships[candidate.id]}
                | ({candidate.department_id} if candidate.department_id else set())
            ).intersection(allowed)
        ]
        departments = [department for department in departments if department.id in allowed]

    people = []
    for person in users:
        rows = memberships[person.id]
        dto_rows = [DepartmentMembershipResponse(
            id=membership.department_id,
            name=department_map[membership.department_id].name,
            is_primary=membership.is_primary,
            membership_id=membership.id,
            role_override=membership.role_override,
        ) for membership in rows if membership.department_id in department_map]
        if not rows and person.department_id in department_map:
            department = department_map[person.department_id]
            dto_rows.append(DepartmentMembershipResponse(id=department.id, name=department.name, is_primary=True))
        dto_rows.sort(key=lambda row: (not row.is_primary, row.name))
        people.append(operational_user(db, person, memberships=dto_rows).model_dump(mode="json"))
    return {
        "users": people,
        "departments": serialize_many(departments),
    }
