from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..clock import as_utc, utc_now
from ..database import get_db
from ..utils import model_to_dict
from .api import require_user

router = APIRouter(prefix="/api")

# Task due dates are UTC instants, but the property's workday follows Philippine time.
PROPERTY_TIMEZONE = ZoneInfo("Asia/Manila")
RECENTLY_COMPLETED_DAYS = 7
RECENTLY_COMPLETED_LIMIT = 10


@router.get("/my-work")
def my_work(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    now = utc_now()
    today = now.astimezone(PROPERTY_TIMEZONE).date()

    # Do not exclude completed tasks from "Recently completed" simply because
    # the automatic archive process has moved them out of the active task queue.
    recent = (
        db.query(models.Task)
        .filter(
            models.Task.assigned_to_id == user.id,
            models.Task.status == "Done",
            models.Task.completed_at.isnot(None),
            models.Task.completed_at >= now - timedelta(days=RECENTLY_COMPLETED_DAYS),
        )
        .order_by(models.Task.completed_at.desc(), models.Task.id.desc())
        .limit(RECENTLY_COMPLETED_LIMIT)
        .all()
    )
    tasks = (
        db.query(models.Task)
        .filter(
            models.Task.assigned_to_id == user.id,
            models.Task.hidden_from_active.is_(False),
            models.Task.status != "Done",
        )
        .order_by(models.Task.due_date.asc().nullslast(), models.Task.updated_at.desc())
        .all()
    )

    department_ids = {task.department_id for task in [*tasks, *recent] if task.department_id is not None}
    departments = (
        {row.id: row.name for row in db.query(models.Department).filter(models.Department.id.in_(department_ids)).all()}
        if department_ids else {}
    )

    def item_for(task: models.Task):
        item = model_to_dict(task)
        item["department_name"] = departments.get(task.department_id)
        return item

    grouped = {"overdue": [], "today": [], "upcoming": [], "waiting": [], "recently_completed": []}
    for task in tasks:
        item = item_for(task)
        status = str(task.status or "").strip().lower()
        due_day = as_utc(task.due_date).astimezone(PROPERTY_TIMEZONE).date() if task.due_date else None

        if status in {"review", "waiting", "blocked"}:
            grouped["waiting"].append(item)
        elif due_day is not None and due_day < today:
            grouped["overdue"].append(item)
        elif due_day == today:
            grouped["today"].append(item)
        else:
            grouped["upcoming"].append(item)

    grouped["recently_completed"] = [item_for(task) for task in recent]
    return {"user": {"id": user.id, "name": user.name, "role": user.role}, "groups": grouped}
