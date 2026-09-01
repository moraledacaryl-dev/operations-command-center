from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import foundation_models as foundation
from .. import models
from ..clock import utc_now
from ..database import get_db
from ..pagination import cursor_page
from ..utils import model_to_dict
from .api import require_user


router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    query = db.query(foundation.Notification).filter(
        foundation.Notification.user_id == user.id,
        foundation.Notification.dismissed_at.is_(None),
    )
    if unread_only:
        query = query.filter(foundation.Notification.read_at.is_(None))
    page = cursor_page(query, foundation.Notification, "notifications", limit, cursor)
    page["unread_count"] = db.query(foundation.Notification).filter(
        foundation.Notification.user_id == user.id,
        foundation.Notification.read_at.is_(None),
        foundation.Notification.dismissed_at.is_(None),
    ).count()
    return page


def _owned_notification(db: Session, user_id: int, notification_id: int) -> foundation.Notification:
    row = db.query(foundation.Notification).filter(
        foundation.Notification.id == notification_id,
        foundation.Notification.user_id == user_id,
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return row


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    row = _owned_notification(db, user.id, notification_id)
    row.read_at = row.read_at or utc_now()
    db.commit()
    db.refresh(row)
    return model_to_dict(row)


@router.post("/read-all")
def mark_all_read(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    now = utc_now()
    count = db.query(foundation.Notification).filter(
        foundation.Notification.user_id == user.id,
        foundation.Notification.read_at.is_(None),
        foundation.Notification.dismissed_at.is_(None),
    ).update({foundation.Notification.read_at: now}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": count}


@router.post("/{notification_id}/dismiss")
def dismiss(notification_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    row = _owned_notification(db, user.id, notification_id)
    row.dismissed_at = utc_now()
    db.commit()
    db.refresh(row)
    return model_to_dict(row)
