from __future__ import annotations

import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "operations_session")


def current_session_version(db: Session, user_id: int) -> int | None:
    row = db.execute(
        text("SELECT session_version FROM users WHERE id = :user_id"),
        {"user_id": int(user_id)},
    ).first()
    if not row:
        return None
    return int(row[0] or 0)


def token_session_is_current(db: Session, payload: dict[str, Any]) -> bool:
    try:
        user_id = int(payload.get("sub", 0))
        token_version = int(payload.get("sv", -1))
    except (TypeError, ValueError):
        return False
    current = current_session_version(db, user_id)
    return current is not None and token_version >= 0 and token_version == current


def revoke_user_sessions(db: Session, user_id: int) -> int:
    db.execute(
        text("UPDATE users SET session_version = session_version + 1 WHERE id = :user_id"),
        {"user_id": int(user_id)},
    )
    db.commit()
    current = current_session_version(db, int(user_id))
    return int(current or 0)
