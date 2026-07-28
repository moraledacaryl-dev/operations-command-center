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
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", str(60 * 60 * 24 * 14)))
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


def _cookie_header(token: str) -> bytes:
    value = (
        f"{COOKIE_NAME}={token}; Path=/; Max-Age={SESSION_TTL_SECONDS}; "
        "HttpOnly; Secure; SameSite=Lax"
    )
    return value.encode("latin-1")


class UploadAccessMiddleware:
    """Require an authenticated session for uploaded-file delivery.

    Login responses retain the existing bearer token and additionally receive an
    HttpOnly session cookie so normal browser links to /uploads continue to work.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }

        if path.startswith("/uploads/"):
            payload = _verify_token(_request_token(headers))
            if payload is None:
                response = JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication is required to access uploaded files."},
                    headers={"Cache-Control": "no-store"},
                )
                await response(scope, receive, send)
                return

            async def protected_send(message):
                if message["type"] == "http.response.start":
                    response_headers = list(message.get("headers", []))
                    response_headers.extend([
                        (b"cache-control", b"private, no-store"),
                        (b"x-content-type-options", b"nosniff"),
                        (b"content-security-policy", b"default-src 'none'; sandbox"),
                    ])
                    message["headers"] = response_headers
                await send(message)

            await self.app(scope, receive, protected_send)
            return

        if path == "/api/auth/login" and scope.get("method", "GET").upper() == "POST":
            buffered: list[dict] = []

            async def capture(message):
                buffered.append(message)

            await self.app(scope, receive, capture)
            token = None
            body = b"".join(
                message.get("body", b"")
                for message in buffered
                if message.get("type") == "http.response.body"
            )
            try:
                data = json.loads(body or b"{}")
                if isinstance(data, dict):
                    token = data.get("token")
            except Exception:
                token = None

            for message in buffered:
                if message.get("type") == "http.response.start" and _verify_token(token):
                    response_headers = list(message.get("headers", []))
                    response_headers.append((b"set-cookie", _cookie_header(token)))
                    message["headers"] = response_headers
                await send(message)
            return

        await self.app(scope, receive, send)
