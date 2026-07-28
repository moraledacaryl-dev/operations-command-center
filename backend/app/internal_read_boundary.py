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

# Public health and authenticated application APIs remain unchanged. This
# boundary covers legacy operational summary reads that predate require_user.
PROTECTED_READ_PATHS = {
    "/api/integrations/overview",
}


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _token_from_headers(headers: dict[str, str]) -> str | None:
    authorization = headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip()

    raw_cookie = headers.get("cookie", "")
    if not raw_cookie:
        return None
    try:
        cookie = SimpleCookie()
        cookie.load(raw_cookie)
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else None
    except Exception:
        return None


def _valid_session(token: str | None) -> dict[str, Any] | None:
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
        if not isinstance(payload, dict):
            return None
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        if not payload.get("sub") or not payload.get("iat"):
            return None
        return payload
    except Exception:
        return None


class InternalReadBoundaryMiddleware:
    """Require authentication for legacy internal operational summary reads."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        if method not in {"GET", "HEAD"} or path not in PROTECTED_READ_PATHS:
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        if _valid_session(_token_from_headers(headers)) is None:
            response = JSONResponse(
                status_code=401,
                content={"detail": "Authentication is required to view internal operational summaries."},
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return

        async def protected_send(message):
            if message.get("type") == "http.response.start":
                response_headers = list(message.get("headers", []))
                response_headers.append((b"cache-control", b"private, no-store"))
                message["headers"] = response_headers
            await send(message)

        await self.app(scope, receive, protected_send)
