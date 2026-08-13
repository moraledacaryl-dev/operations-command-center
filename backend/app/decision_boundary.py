from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from starlette.responses import JSONResponse


SESSION_SECRET = os.getenv("SESSION_SECRET", "local-command-center-secret")
DECISION_ROLES = {"owner", "admin", "manager"}


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


def _decision_from_request(method: str, path: str, content_type: str, body: bytes) -> bool:
    if method != "POST":
        return False

    if path.startswith("/api/integrations/review-items/") and path.endswith("/reject"):
        return True
    if path.startswith("/api/workflow/fixes/") and path.endswith("/verify"):
        return True

    # Generic Approval status mutation is workflow-owned and must reach the
    # authorization policy so every role receives the canonical 405 response.
    # Decision authorization belongs on the canonical Approval decision path,
    # not on the generic CRUD/status path.
    parts = [part for part in path.split("/") if part]
    if len(parts) == 4 and parts[0] == "api" and parts[1] == "fixes" and parts[3] == "status":
        normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
        if normalized_type == "application/json" or normalized_type.endswith("+json"):
            try:
                payload = json.loads(body or b"{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                return False
            status = str(payload.get("status") or "").strip().lower() if isinstance(payload, dict) else ""
            if status == "verified":
                return True
    return False


class DecisionBoundaryMiddleware:
    """Require managerial authority for approvals, rejections, and verification."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        if method != "POST":
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        more_body = True
        while more_body:
            message = await receive()
            if message.get("type") != "http.request":
                continue
            chunks.append(message.get("body", b""))
            more_body = bool(message.get("more_body", False))
        body = b"".join(chunks)

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        requires_decision_role = _decision_from_request(
            method,
            path,
            headers.get("content-type", ""),
            body,
        )

        if requires_decision_role:
            payload = _token_payload(headers.get("authorization"))
            if payload is not None:
                role = str(payload.get("role") or "").strip().lower()
                if role not in DECISION_ROLES:
                    response = JSONResponse(
                        status_code=403,
                        content={
                            "detail": "Manager, administrator, or owner authority is required for approvals, rejections, and verification."
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
