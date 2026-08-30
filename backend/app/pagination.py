from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, or_

from .clock import as_utc
from .utils import serialize_many


CURSOR_SECRET = os.getenv("CURSOR_SECRET", os.getenv("SESSION_SECRET", "local-command-center-secret"))


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def encode_cursor(resource: str, updated_at: datetime, item_id: int) -> str:
    body = _b64(json.dumps({"r": resource, "t": as_utc(updated_at).isoformat(), "i": int(item_id)}, separators=(",", ":")).encode())
    signature = _b64(hmac.new(CURSOR_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def encode_history_cursor(updated_at: datetime, resource: str, item_id: int) -> str:
    body = _b64(json.dumps({"r": "history", "t": as_utc(updated_at).isoformat(), "k": resource, "i": int(item_id)}, separators=(",", ":")).encode())
    signature = _b64(hmac.new(CURSOR_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def decode_cursor(resource: str, cursor: str) -> tuple[datetime, int]:
    try:
        body, signature = cursor.split(".", 1)
        expected = _b64(hmac.new(CURSOR_SECRET.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        payload = json.loads(_unb64(body))
        if payload.get("r") != resource:
            raise ValueError("resource")
        timestamp = as_utc(datetime.fromisoformat(str(payload["t"]).replace("Z", "+00:00")))
        item_id = int(payload["i"])
        if item_id < 1:
            raise ValueError("id")
        return timestamp, item_id
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid or expired pagination cursor.") from exc


def decode_history_cursor(cursor: str) -> tuple[datetime, str, int]:
    try:
        body, signature = cursor.split(".", 1)
        expected = _b64(hmac.new(CURSOR_SECRET.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        payload = json.loads(_unb64(body))
        if payload.get("r") != "history":
            raise ValueError("resource")
        timestamp = as_utc(datetime.fromisoformat(str(payload["t"]).replace("Z", "+00:00")))
        kind = str(payload["k"])
        item_id = int(payload["i"])
        if not kind or item_id < 1:
            raise ValueError("key")
        return timestamp, kind, item_id
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid or expired pagination cursor.") from exc


def cursor_page(query, model, resource: str, limit: int, cursor: str | None = None) -> dict:
    if not hasattr(model, "updated_at"):
        raise HTTPException(status_code=400, detail="This resource does not support cursor pagination.")
    if cursor:
        timestamp, item_id = decode_cursor(resource, cursor)
        query = query.filter(or_(
            model.updated_at < timestamp,
            and_(model.updated_at == timestamp, model.id < item_id),
        ))
    rows = query.order_by(model.updated_at.desc(), model.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    next_cursor = encode_cursor(resource, page_rows[-1].updated_at, page_rows[-1].id) if has_more and page_rows else None
    return {"items": serialize_many(page_rows), "next_cursor": next_cursor, "has_more": has_more}


__all__ = ["cursor_page", "decode_cursor", "decode_history_cursor", "encode_cursor", "encode_history_cursor"]
