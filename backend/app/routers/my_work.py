from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..clock import utc_now
from ..database import get_db
from ..utils import model_to_dict
from .api import require_user

router = APIRouter(prefix="/api")


@router.get("/my-work")
def my_work(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    tasks = (
        db.query(models.Task)
        .filter(models.Task.assigned_to_id == user.id)
        .filter(models.Task.hidden_from_active.is_(False))
        .order_by(models.Task.due_date.asc().nullslast(), models.Task.updated_at.desc())
        .all()
    )
    departments = {row.id: row.name for row in db.query(models.Department).all()}
    now = utc_now()

    grouped = {"overdue": [], "today": [], "upcoming": [], "waiting": [], "recently_completed": []}
    for task in tasks:
        item = model_to_dict(task)
        item["department_name"] = departments.get(task.department_id)
        status = str(task.status or "").strip().lower()
        due = task.due_date

        if status == "done":
            grouped["recently_completed"].append(item)
        elif status in {"review", "waiting", "blocked"}:
            grouped["waiting"].append(item)
        elif due and due.date() < now.date():
            grouped["overdue"].append(item)
        elif due and due.date() == now.date():
            grouped["today"].append(item)
        else:
            grouped["upcoming"].append(item)

    grouped["recently_completed"] = grouped["recently_completed"][:10]
    return {"user": {"id": user.id, "name": user.name, "role": user.role}, "groups": grouped}
