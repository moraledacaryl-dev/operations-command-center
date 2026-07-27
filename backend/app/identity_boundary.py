from __future__ import annotations

import json
import re
from typing import Any

from starlette.responses import JSONResponse


PROTECTED_IDENTITY_FIELDS = {
    "actor_id",
    "author_id",
    "uploaded_by_id",
    "decided_by_id",
    "verified_by_id",
    "requested_by_id",
    "created_by_id",
    "assigned_by_id",
    "approved_by_id",
    "rejected_by_id",
    "completed_by_id",
}

WRITE_METHODS = {"POST", "PUT", "PATCH"}
EXEMPT_PREFIXES = (
    "/api/integrations/",
    "/api/auth/login",
)


def _find_protected_field(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).strip().lower()
            if normalized in PROTECTED_IDENTITY_FIELDS:
                return normalized
            found = _find_protected_field(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_protected_field(item)
            if found:
                return found
    return None


def _multipart_field(body: bytes) -> str | None:
    text = body.decode("utf-8", errors="ignore")
    for field in PROTECTED_IDENTITY_FIELDS:
        if re.search(rf'name="{re.escape(field)}"', text, flags=re.IGNORECASE):
            return field
    return None


def find_protected_identity_field(content_type: str, body: bytes) -> str | None:
    if not body:
        return None

    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type == "application/json" or normalized_type.endswith("+json"):
        try:
            return _find_protected_field(json.loads(body))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    if normalized_type == "application/x-www-form-urlencoded":
        text = body.decode("utf-8", errors="ignore").lower()
        for field in PROTECTED_IDENTITY_FIELDS:
            if re.search(rf"(?:^|&){re.escape(field)}=", text):
                return field
        return None

    if normalized_type == "multipart/form-data":
        return _multipart_field(body)

    return None


class IdentityBoundaryMiddleware:
    """Reject client attempts to attribute actions to another user.

    Audit identity must always come from the authenticated session. Integration
    endpoints are exempt because external event envelopes have their own shared
    secret and may legitimately contain source-system identity metadata.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        if method not in WRITE_METHODS or any(path.startswith(prefix) for prefix in EXEMPT_PREFIXES):
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                continue
            chunks.append(message.get("body", b""))
            more_body = bool(message.get("more_body", False))

        body = b"".join(chunks)
        headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}
        protected = find_protected_identity_field(headers.get("content-type", ""), body)
        if protected:
            response = JSONResponse(
                status_code=400,
                content={
                    "detail": f"Field '{protected}' is server-controlled. Action identity comes from the authenticated session."
                },
            )
            await response(scope, receive, send)
            return

        delivered = False

        async def replay_receive():
            nonlocal delivered
            if delivered:
                return {"type": "http.request", "body": b"", "more_body": False}
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_receive, send)
