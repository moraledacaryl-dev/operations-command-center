from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from http.cookies import SimpleCookie
from typing import Any

from starlette.responses import JSONResponse

from . import models
from .database import SessionLocal


SESSION_SECRET = os.getenv("SESSION_SECRET", "local-command-center-secret")
COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "operations_session")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _verify_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        body, signature = token.split(".", 1)
        expected = base64.urlsafe_b64encode(
            hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_unb64(body))
        if not isinstance(payload, dict) or int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _request_token(headers: dict[str, str]) -> str | None:
    authorization = headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip()

    raw_cookie = headers.get("cookie", "")
    if raw_cookie:
        cookie = SimpleCookie()
        try:
            cookie.load(raw_cookie)
            morsel = cookie.get(COOKIE_NAME)
            if morsel:
                return morsel.value
        except Exception:
            return None
    return None


def _expired_cookie() -> str:
    return f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"


class AuthorizationFreshnessMiddleware:
    """Ensure token authorization claims still match the current user record."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        payload = _verify_token(_request_token(headers))
        if payload is None:
            await self.app(scope, receive, send)
            return

        try:
            user_id = int(payload.get("sub", 0))
        except (TypeError, ValueError):
            user_id = 0

        with SessionLocal() as db:
            user = db.get(models.User, user_id) if user_id else None
            current_role = str(user.role or "").strip().lower() if user and user.is_active else None

        token_role = str(payload.get("role") or "").strip().lower()
        if current_role is None or token_role != current_role:
            response = JSONResponse(
                status_code=401,
                content={"detail": "Your account permissions changed. Please sign in again."},
                headers={
                    "Cache-Control": "no-store",
                    "Set-Cookie": _expired_cookie(),
                },
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
