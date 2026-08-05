from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils import serialize_many
from .api import can_view_all, department_ids_for, require_user


router = APIRouter(prefix="/api")


@router.get("/review/queue")
def review_queue(
    department_id: Optional[int] = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Return the manager review queue from a fixed route.

    This router is included before the legacy generic resource router so
    ``/api/review/queue`` cannot be interpreted as resource ``review`` with
    item id ``queue``.
    """
    if department_id and not can_view_all(user):
        allowed = department_ids_for(db, user)
        if int(department_id) not in allowed:
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="No access to this department")

    def maybe_department(query, model):
        if department_id and hasattr(model, "department_id"):
            return query.filter(model.department_id == department_id)
        if not can_view_all(user) and hasattr(model, "department_id"):
            return query.filter(model.department_id.in_(department_ids_for(db, user)))
        return query

    return {
        "submissions": serialize_many(
            db.query(models.Submission)
            .filter(
                models.Submission.hidden_from_active == False,
                models.Submission.review_status.in_(["New", "Review"]),
            )
            .order_by(models.Submission.updated_at.desc())
            .limit(25)
            .all()
        ),
        "approvals": serialize_many(
            maybe_department(db.query(models.Approval), models.Approval)
            .filter(
                models.Approval.hidden_from_active == False,
                models.Approval.status == "Pending",
            )
            .order_by(models.Approval.updated_at.desc())
            .limit(25)
            .all()
        ),
        "requests": serialize_many(
            maybe_department(db.query(models.Request), models.Request)
            .filter(
                models.Request.hidden_from_active == False,
                models.Request.status.in_(["Draft", "Review", "Planned"]),
            )
            .order_by(models.Request.updated_at.desc())
            .limit(25)
            .all()
        ),
        "posts": serialize_many(
            maybe_department(db.query(models.Post), models.Post)
            .filter(
                models.Post.hidden_from_active == False,
                models.Post.status.in_(["Review", "Fix"]),
            )
            .order_by(models.Post.updated_at.desc())
            .limit(25)
            .all()
        ),
        "fixes": serialize_many(
            maybe_department(db.query(models.Fix), models.Fix)
            .filter(
                models.Fix.hidden_from_active == False,
                models.Fix.status == "Done",
            )
            .order_by(models.Fix.updated_at.desc())
            .limit(25)
            .all()
        ),
        "external": serialize_many(
            maybe_department(db.query(models.ExternalReviewItem), models.ExternalReviewItem)
            .filter(
                models.ExternalReviewItem.status.in_(
                    ["For Review", "Ready to Post", "Seen", "Pending Approval", "In Progress"]
                )
            )
            .order_by(models.ExternalReviewItem.updated_at.desc())
            .limit(50)
            .all()
        ),
    }
