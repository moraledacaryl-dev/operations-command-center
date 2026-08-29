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
from .session_security import COOKIE_NAME, current_session_version, revoke_user_sessions, token_session_is_current

SESSION_SECRET = os.getenv("SESSION_SECRET", "local-command-center-secret")
PUBLIC_PATHS = {"/api/health", "/api/auth/login"}


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(payload: dict[str, Any]) -> str:
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = _b64(hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def _verify(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        body, signature = token.split(".", 1)
        expected = _b64(hmac.new(SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(_unb64(body))
        if not isinstance(payload, dict) or int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _cookie_token(headers: dict[str, str]) -> str | None:
    raw_cookie = headers.get("cookie", "")
    if not raw_cookie:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(raw_cookie)
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else None
    except Exception:
        return None


def _request_token(headers: dict[str, str]) -> tuple[str | None, bool]:
    authorization = headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip(), False
    token = _cookie_token(headers)
    return token, bool(token)


def _clear_cookie() -> bytes:
    return f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax".encode("latin-1")


def _session_cookie(token: str) -> bytes:
    return f"{COOKIE_NAME}={token}; Path=/; HttpOnly; Secure; SameSite=Lax".encode("latin-1")


def _inject_internal_bearer(scope, token: str) -> None:
    headers = list(scope.get("headers", []))
    if any(key.lower() == b"authorization" for key, _ in headers):
        return
    headers.append((b"authorization", f"Bearer {token}".encode("latin-1")))
    scope["headers"] = headers


class SessionLifecycleMiddleware:
    """Issue HttpOnly browser sessions, revoke sessions durably, and validate freshness."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        token, from_cookie = _request_token(headers)

        if path == "/api/auth/logout" and method == "POST":
            payload = _verify(token)
            if payload is not None:
                try:
                    user_id = int(payload.get("sub", 0))
                except (TypeError, ValueError):
                    user_id = 0
                if user_id:
                    with SessionLocal() as db:
                        revoke_user_sessions(db, user_id)
            response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
            response.raw_headers.append((b"set-cookie", _clear_cookie()))
            await response(scope, receive, send)
            return

        if path.startswith("/api/") and path not in PUBLIC_PATHS:
            payload = _verify(token)
            if payload is not None:
                issued_at = int(payload.get("iat", 0))
                if issued_at <= 0:
                    response = JSONResponse(status_code=401, content={"detail": "Session refresh required. Please sign in again."}, headers={"Cache-Control": "no-store"})
                    response.raw_headers.append((b"set-cookie", _clear_cookie()))
                    await response(scope, receive, send)
                    return
                with SessionLocal() as db:
                    user = db.get(models.User, int(payload.get("sub", 0)))
                    changed_at = int(user.password_set_at.timestamp()) if user and user.password_set_at else 0
                    current = bool(user and user.is_active and issued_at >= changed_at and token_session_is_current(db, payload))
                if not current:
                    response = JSONResponse(status_code=401, content={"detail": "Session is no longer valid. Please sign in again."}, headers={"Cache-Control": "no-store"})
                    response.raw_headers.append((b"set-cookie", _clear_cookie()))
                    await response(scope, receive, send)
                    return
                if from_cookie and token:
                    # Existing dependencies continue to consume Authorization,
                    # but the browser never receives or stores the bearer value.
                    _inject_internal_bearer(scope, token)

        if path == "/api/auth/login" and method == "POST":
            buffered: list[dict] = []

            async def capture(message):
                buffered.append(message)

            await self.app(scope, receive, capture)
            body = b"".join(m.get("body", b"") for m in buffered if m.get("type") == "http.response.body")
            replacement = None
            try:
                data = json.loads(body or b"{}")
                payload = _verify(data.get("token") if isinstance(data, dict) else None)
                if payload:
                    with SessionLocal() as db:
                        version = current_session_version(db, int(payload.get("sub", 0)))
                    if version is None:
                        raise ValueError("unknown session user")
                    payload["iat"] = int(time.time())
                    payload["sv"] = int(version)
                    replacement = _sign(payload)
                    # Cookie is the browser credential. Never expose the bearer
                    # in response JSON where XSS/localStorage can capture it.
                    data.pop("token", None)
                    new_body = json.dumps(data, separators=(",", ":")).encode()
                else:
                    new_body = body
            except Exception:
                new_body = body
            for message in buffered:
                if message.get("type") == "http.response.start" and replacement:
                    hs = [(k, v) for k, v in message.get("headers", []) if k.lower() not in {b"content-length", b"set-cookie"}]
                    hs.extend([
                        (b"content-length", str(len(new_body)).encode()),
                        (b"set-cookie", _session_cookie(replacement)),
                    ])
                    message["headers"] = hs
                elif message.get("type") == "http.response.body" and replacement:
                    message["body"] = new_body
                await send(message)
            return

        await self.app(scope, receive, send)
