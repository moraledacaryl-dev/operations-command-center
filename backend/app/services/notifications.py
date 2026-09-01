from __future__ import annotations

import re

from sqlalchemy.orm import Session

from .. import foundation_models as foundation
from .. import models


MENTION_PATTERN = re.compile(r"@\[([^\]]+)\]|@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")


def notify_user(
    db: Session,
    user_id: int | None,
    kind: str,
    title: str,
    body: str | None = None,
    *,
    source_type: str | None = None,
    source_id: int | str | None = None,
    action_url: str | None = None,
    priority: str = "Normal",
) -> foundation.Notification | None:
    if not user_id or db.get(models.User, int(user_id)) is None:
        return None
    row = foundation.Notification(
        user_id=int(user_id),
        kind=kind[:80],
        title=title[:180],
        body=body,
        source_type=source_type,
        source_id=str(source_id) if source_id is not None else None,
        action_url=action_url,
        priority=priority,
    )
    db.add(row)
    return row


def create_mentions(
    db: Session,
    body: str,
    *,
    mentioned_by_id: int | None,
    parent_type: str,
    parent_id: int | str,
    action_url: str | None = None,
) -> list[foundation.Mention]:
    tokens = {next(value for value in match.groups() if value).strip().lower() for match in MENTION_PATTERN.finditer(body or "")}
    if not tokens:
        return []
    candidates = db.query(models.User).filter(models.User.is_active == True).all()
    matches = [candidate for candidate in candidates if str(candidate.name or "").strip().lower() in tokens or str(candidate.email or "").strip().lower() in tokens]
    created: list[foundation.Mention] = []
    for candidate in matches:
        if mentioned_by_id and candidate.id == mentioned_by_id:
            continue
        mention = foundation.Mention(
            mentioned_user_id=candidate.id,
            mentioned_by_id=mentioned_by_id,
            parent_type=parent_type,
            parent_id=str(parent_id),
            body=body,
        )
        db.add(mention)
        created.append(mention)
        notify_user(
            db,
            candidate.id,
            "mention",
            f"You were mentioned in {parent_type.replace('-', ' ')}",
            body[:500],
            source_type=parent_type,
            source_id=parent_id,
            action_url=action_url,
        )
    return created


__all__ = ["create_mentions", "notify_user"]
