from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, and_, cast, or_
from sqlalchemy.orm import Session

from .. import foundation_models as foundation
from .. import models
from ..clock import utc_now
from ..authorization_policy import MODEL_RESOURCE_NAMES, scope_query
from ..database import get_db
from ..pagination import cursor_page
from ..utils import model_to_dict
from .api import require_user


router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _visible_notifications(db: Session, user: models.User):
    """A stored title/body is private source data even after delivery.

    Recheck current source access before pagination, counts or serialization.
    Keep inaccessible history intact so regranted access can recover it.
    Unknown, malformed, missing and partially specified sources fail closed.
    """
    notification = foundation.Notification
    visible = [and_(notification.source_type.is_(None), notification.source_id.is_(None))]
    for model, resource in MODEL_RESOURCE_NAMES.items():
        try:
            source = scope_query(db, user, model, db.query(model.id))
        except HTTPException as exc:
            if exc.status_code != 403:
                raise
            continue
        # Cast the integer PK, rather than untrusted historical source_id:
        # a malformed source_id must never cause a PostgreSQL cast failure.
        visible.append(and_(
            notification.source_type == resource,
            source.filter(cast(model.id, String) == notification.source_id).exists(),
        ))
    return db.query(notification).filter(notification.user_id == user.id, or_(*visible))


@router.get("")
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    query = _visible_notifications(db, user).filter(foundation.Notification.dismissed_at.is_(None))
    if unread_only:
        query = query.filter(foundation.Notification.read_at.is_(None))
    page = cursor_page(query, foundation.Notification, "notifications", limit, cursor)
    page["unread_count"] = _visible_notifications(db, user).filter(
        foundation.Notification.read_at.is_(None),
        foundation.Notification.dismissed_at.is_(None),
    ).count()
    return page


def _owned_notification(db: Session, user: models.User, notification_id: int) -> foundation.Notification:
    row = _visible_notifications(db, user).filter(
        foundation.Notification.id == notification_id,
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return row


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    row = _owned_notification(db, user, notification_id)
    row.read_at = row.read_at or utc_now()
    db.commit()
    db.refresh(row)
    return model_to_dict(row)


@router.post("/read-all")
def mark_all_read(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    now = utc_now()
    count = _visible_notifications(db, user).filter(
        foundation.Notification.read_at.is_(None),
        foundation.Notification.dismissed_at.is_(None),
    ).update({foundation.Notification.read_at: now}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": count}


@router.post("/{notification_id}/dismiss")
def dismiss(notification_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    row = _owned_notification(db, user, notification_id)
    row.dismissed_at = utc_now()
    db.commit()
    db.refresh(row)
    return model_to_dict(row)
