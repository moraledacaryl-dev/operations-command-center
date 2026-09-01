from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from starlette.responses import JSONResponse

from .capabilities import has_capability


SESSION_SECRET = os.getenv("SESSION_SECRET", "local-command-center-secret")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _token_payload(authorization: str | None) -> dict[str, Any] | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    try:
        body, signature = token.split(".", 1)
        expected = base64.urlsafe_b64encode(
            hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_unb64(body))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _required_capability(method: str, path: str) -> str | None:
    if path.startswith("/api/admin/user-departments"):
        return "manage_accounts"
    if path.startswith("/api/admin/users"):
        return "manage_accounts"
    if path.startswith("/api/admin/"):
        return "manage_system"
    if method not in WRITE_METHODS:
        return None
    if path == "/api/users" or path.startswith("/api/users/"):
        return "manage_accounts"
    if path == "/api/user-departments" or path.startswith("/api/user-departments/"):
        return "manage_accounts"
    if path == "/api/departments" or path.startswith("/api/departments/"):
        return "manage_system"
    return None


class RoleBoundaryMiddleware:
    """Enforce capability boundaries before account and system administration routes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        required = _required_capability(method, path)
        if required is None:
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        payload = _token_payload(headers.get("authorization"))
        if payload is None:
            await self.app(scope, receive, send)
            return

        if not has_capability(payload.get("role"), required):
            response = JSONResponse(
                status_code=403,
                content={"detail": f"The {required.replace('_', ' ')} capability is required."},
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
