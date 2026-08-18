from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import scope_query
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
    if department_id and not can_view_all(user):
        allowed = department_ids_for(db, user)
        if int(department_id) not in allowed:
            raise HTTPException(status_code=403, detail="No access to this department")

    def maybe_department(query, model):
        query = scope_query(db, user, model, query)
        if department_id and hasattr(model, "department_id"):
            query = query.filter(model.department_id == department_id)
        return query

    return {
        "submissions": serialize_many(
            maybe_department(db.query(models.Submission), models.Submission)
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
        "requests": [],
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
