from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from starlette.responses import JSONResponse


SESSION_SECRET = os.getenv("SESSION_SECRET", "local-command-center-secret")
ACCOUNT_ADMIN_ROLES = {"owner", "admin"}
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


def _requires_account_admin(method: str, path: str) -> bool:
    if path.startswith("/api/admin/"):
        return True

    if method not in WRITE_METHODS:
        return False

    protected_prefixes = (
        "/api/users",
        "/api/user-departments",
        "/api/departments",
    )
    return any(path == prefix or path.startswith(prefix + "/") for prefix in protected_prefixes)


class RoleBoundaryMiddleware:
    """Separate operational management from account administration.

    Managers retain broad operational visibility and workflow access, but only
    owners and administrators may create accounts, reset passwords, edit user
    membership, or mutate the department directory.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        if not _requires_account_admin(method, path):
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

        role = str(payload.get("role") or "").strip().lower()
        if role not in ACCOUNT_ADMIN_ROLES:
            response = JSONResponse(
                status_code=403,
                content={
                    "detail": "Owner or administrator access is required for account and department administration."
                },
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
