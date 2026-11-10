"""A Bar employee may report a problem without gaining supervisor powers."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..database import get_db
from ..utils import log_activity, model_to_dict
from .api import require_user

router = APIRouter(prefix="/api/bar", tags=["Bar"])


class BarReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=4, max_length=180)
    kind: Literal["Low stock", "Equipment", "Drink complaint", "Handover", "Other"]
    details: str = Field(min_length=8, max_length=3000)
    urgency: Literal["Low", "Normal", "High", "Urgent"] = "Normal"
    shift: Literal["AM", "PM", "Night"] | None = None


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
