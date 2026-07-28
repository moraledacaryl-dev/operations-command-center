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

SESSION_SECRET = os.getenv("SESSION_SECRET", "local-command-center-secret")
COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "operations_session")
PUBLIC_GET_PATHS = {"/api/health"}


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _token(headers: dict[str, str]) -> str | None:
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


def _valid_session(token: str | None) -> bool:
    if not token:
        return False
    try:
        body, signature = token.split(".", 1)
        expected = base64.urlsafe_b64encode(
            hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        if not hmac.compare_digest(signature, expected):
            return False
        payload: dict[str, Any] = json.loads(_unb64(body))
        return bool(payload.get("sub") and payload.get("iat") and int(payload.get("exp", 0)) >= int(time.time()))
    except Exception:
        return False


class ApiReadBoundaryMiddleware:
    """Require authentication for every internal API GET except explicit public routes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        if method != "GET" or not path.startswith("/api") or path in PUBLIC_GET_PATHS:
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        if not _valid_session(_token(headers)):
            response = JSONResponse(
                status_code=401,
                content={"detail": "Authentication is required to access internal API data."},
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return

        async def private_send(message):
            if message.get("type") == "http.response.start":
                response_headers = list(message.get("headers", []))
                response_headers.append((b"cache-control", b"private, no-store"))
                message["headers"] = response_headers
            await send(message)

        await self.app(scope, receive, private_send)
