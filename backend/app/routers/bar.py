"""A Bar employee may report a problem without gaining supervisor powers."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..database import get_db
from ..services.notifications import notify_user
from ..utils import log_activity, model_to_dict
from .api import require_user
from .authorized_crud import _require_assignee_visibility

router = APIRouter(prefix="/api/bar", tags=["Bar"])


class BarReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=4, max_length=180)
    kind: Literal["Low stock", "Equipment", "Drink complaint", "Handover", "Other"]
    details: str = Field(min_length=8, max_length=3000)
    urgency: Literal["Low", "Normal", "High", "Urgent"] = "Normal"
    shift: Literal["AM", "PM", "Night"] | None = None


class BarTaskAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assigned_to_id: int = Field(gt=0)


@router.post("/reports", status_code=201)
def report_bar_problem(payload: BarReport, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    department = db.query(models.Department).filter(func.lower(models.Department.name) == "bar").one_or_none()
    if department is None:
        raise HTTPException(status_code=503, detail="Bar workspace is not set up yet.")
    authorize_action(db, user, "shift-notes", Action.VIEW, department_id=department.id)
    row = models.ShiftNote(
        title=payload.title.strip(), category=payload.kind, shift=payload.shift,
        note=payload.details.strip(), urgency=payload.urgency,
        department_id=department.id, submitted_by_id=user.id, status="New",
    )
    db.add(row)
    db.flush()
    log_activity(db, "shift-notes", row.id, "created", "Bar report created", actor_id=user.id)
    db.commit()
    db.refresh(row)
    return model_to_dict(row)


@router.post("/reports/{report_id}/task")
def assign_bar_report(report_id: int, payload: BarTaskAssignment, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    department = db.query(models.Department).filter(func.lower(models.Department.name) == "bar").one_or_none()
    if department is None:
        raise HTTPException(status_code=503, detail="Bar workspace is not set up yet.")
    authorize_action(db, user, "tasks", Action.CREATE, department_id=department.id)
    report = db.query(models.ShiftNote).filter(models.ShiftNote.id == report_id).with_for_update().one_or_none()
    if report is None or report.department_id != department.id:
        raise HTTPException(status_code=404, detail="Bar report not found.")
    authorize_action(db, user, "shift-notes", Action.VIEW, obj=report)
    if report.hidden_from_active or report.status == "Done":
        raise HTTPException(status_code=409, detail="This report is finished or archived. Reopen it before assigning work.")
    _require_assignee_visibility(db, "tasks", payload.assigned_to_id, department.id)
    if report.linked_task_id is not None:
        existing = db.get(models.Task, report.linked_task_id)
        if existing is None or existing.department_id != department.id or existing.hidden_from_active:
            raise HTTPException(status_code=409, detail="The linked task needs a manager's attention.")
        authorize_action(db, user, "tasks", Action.VIEW, obj=existing)
        if existing.assigned_to_id != payload.assigned_to_id:
            raise HTTPException(status_code=409, detail="This report already has a task. Open Tasks to change its assignment.")
        return {"task": model_to_dict(existing), "created": False}
    task = models.Task(title=report.title, department_id=department.id, assigned_to_id=payload.assigned_to_id,
                       priority=report.urgency or "Normal", status="To Do", note=report.note)
    db.add(task)
    db.flush()
    report.linked_task_id = task.id
    log_activity(db, "tasks", task.id, "created", "Created from a Bar report", actor_id=user.id)
    log_activity(db, "shift-notes", report.id, "created_task", f"Created task #{task.id}", actor_id=user.id)
    if task.assigned_to_id != user.id:
        notify_user(db, task.assigned_to_id, "assignment", f"Assigned: {task.title}",
                    source_type="tasks", source_id=task.id, action_url="/my-work")
    db.commit()
    db.refresh(task)
    return {"task": model_to_dict(task), "created": True}
