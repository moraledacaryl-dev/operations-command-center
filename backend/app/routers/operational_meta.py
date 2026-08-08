from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils import serialize_many
from .api import can_view_all, department_ids_for, require_user, user_departments

router = APIRouter(prefix="/api")


def operational_user_summary(db: Session, candidate: models.User) -> dict:
    departments = user_departments(db, candidate)
    return {
        "id": candidate.id,
        "name": candidate.name,
        "role": candidate.role,
        "department_id": candidate.department_id,
        "primary_department_id": departments[0]["id"] if departments else candidate.department_id,
        "departments": departments,
    }


@router.get("/meta")
def operational_meta(
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    users = db.query(models.User).filter(models.User.is_active == True).order_by(models.User.name).all()
    departments = db.query(models.Department).order_by(models.Department.name).all()

    if not can_view_all(user):
        allowed = department_ids_for(db, user)
        users = [
            candidate
            for candidate in users
            if candidate.id == user.id or department_ids_for(db, candidate).intersection(allowed)
        ]
        departments = [department for department in departments if department.id in allowed]

    return {
        "users": [operational_user_summary(db, candidate) for candidate in users],
        "departments": serialize_many(departments),
    }
