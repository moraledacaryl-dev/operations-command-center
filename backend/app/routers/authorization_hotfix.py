from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models
from ..capabilities import has_capability
from ..database import get_db
from .api import (
    active_filter,
    apply_search,
    require_user,
    serialize_user,
)

router = APIRouter(prefix="/api")


def require_capability(user: models.User, capability: str) -> None:
    if not has_capability(user.role, capability):
        raise HTTPException(status_code=403, detail="You do not have permission to complete this action.")


@router.get("/users")
def list_sensitive_users(
    active: bool = Query(default=True),
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=100, le=500),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    require_capability(user, "view_sensitive_user_metadata")
    query = db.query(models.User)
    query = active_filter(query, models.User, active)
    query = apply_search(query, models.User, "users", q)
    if hasattr(models.User, "updated_at"):
        query = query.order_by(models.User.updated_at.desc())
    return [serialize_user(db, candidate) for candidate in query.limit(limit).all()]
