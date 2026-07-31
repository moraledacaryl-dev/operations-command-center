from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone


logger = logging.getLogger("operations.security")
SECURITY_STATUSES = {401, 403, 413, 429}


def _headers(scope) -> dict[str, str]:
    return {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in scope.get("headers", [])
    }


def _valid_request_id(value: str) -> bool:
    return bool(value) and len(value) <= 128 and all(ch.isalnum() or ch in "-_.:" for ch in value)


def _ensure_request_id(scope, headers: dict[str, str]) -> str:
    incoming = headers.get("x-request-id", "").strip()
    correlation_id = incoming if _valid_request_id(incoming) else uuid.uuid4().hex

    # Make the outermost correlation ID visible to all inner middleware and
    # route handlers. Replace any invalid or duplicate client-supplied value.
    scope_headers = [
        (key, value)
        for key, value in scope.get("headers", [])
        if key.decode("latin-1").lower() != "x-request-id"
    ]
    scope_headers.append((b"x-request-id", correlation_id.encode("latin-1")))
    scope["headers"] = scope_headers
    headers["x-request-id"] = correlation_id
    return correlation_id


def _client_ip(scope, headers: dict[str, str]) -> str:
    forwarded = headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded[:64]
    client = scope.get("client")
    return str(client[0])[:64] if client else "unknown"


def _auth_mode(headers: dict[str, str]) -> str:
    authorization = headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        return "bearer"
    if headers.get("x-integration-api-key"):
        return "integration_key"
    if "operations_session=" in headers.get("cookie", ""):
        return "session_cookie"
    return "anonymous"


class SecurityAuditMiddleware:
    """Emit structured, secret-free security events to the service journal."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = _headers(scope)
        correlation_id = _ensure_request_id(scope, headers)
        status_code: int | None = None
        response_request_id = ""

        async def audit_send(message):
            nonlocal status_code, response_request_id
            if message.get("type") == "http.response.start":
                status_code = int(message.get("status", 0))
                response_headers = {
                    key.decode("latin-1").lower(): value.decode("latin-1")
                    for key, value in message.get("headers", [])
                }
                response_request_id = response_headers.get("x-request-id", "")
            await send(message)

        await self.app(scope, receive, audit_send)

        if status_code not in SECURITY_STATUSES:
            return

        event = {
            "event": "security_response",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status_code,
            "method": str(scope.get("method", ""))[:16],
            "path": str(scope.get("path", ""))[:512],
            "client_ip": _client_ip(scope, headers),
            "auth_mode": _auth_mode(headers),
            "request_id": response_request_id or correlation_id,
            "origin": headers.get("origin", "")[:256],
        }
        logger.warning(json.dumps(event, separators=(",", ":"), sort_keys=True))
