from __future__ import annotations

import os
from http.cookies import SimpleCookie
from urllib.parse import urlparse

from starlette.responses import JSONResponse

from .security import load_security_settings


COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "operations_session")
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
EXEMPT_PATHS = {"/api/auth/login"}


def _configured_origins() -> set[str]:
    if "CORS_ALLOWED_ORIGINS" in os.environ and "ALLOWED_ORIGINS" not in os.environ:
        raw = os.environ["CORS_ALLOWED_ORIGINS"]
        return {value.strip().rstrip("/") for value in raw.split(",") if value.strip()}
    return {value.rstrip("/") for value in load_security_settings().allowed_origins}


def _headers(scope) -> dict[str, str]:
    return {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in scope.get("headers", [])
    }


def _has_session_cookie(headers: dict[str, str]) -> bool:
    raw = headers.get("cookie", "")
    if not raw:
        return False
    cookie = SimpleCookie()
    try:
        cookie.load(raw)
    except Exception:
        return False
    return bool(cookie.get(COOKIE_NAME) and cookie[COOKIE_NAME].value)


def _uses_non_cookie_auth(headers: dict[str, str]) -> bool:
    authorization = headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        return True
    return bool(headers.get("x-integration-api-key"))


def _origin_from_referer(referer: str) -> str | None:
    try:
        parsed = urlparse(referer)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def _request_origin(headers: dict[str, str]) -> str | None:
    origin = headers.get("origin", "").strip().rstrip("/")
    if origin and origin != "null":
        return origin
    return _origin_from_referer(headers.get("referer", ""))


class CsrfProtectionMiddleware:
    """Reject cross-site state changes made with the browser session cookie.

    Bearer-token and integration-key clients are not vulnerable to ambient-cookie
    CSRF and therefore continue to use their existing authentication contracts.
    """

    def __init__(self, app):
        self.app = app
        self.allowed_origins = _configured_origins()

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        if method not in UNSAFE_METHODS or path in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        headers = _headers(scope)
        if not _has_session_cookie(headers) or _uses_non_cookie_auth(headers):
            await self.app(scope, receive, send)
            return

        origin = _request_origin(headers)
        if not origin or origin not in self.allowed_origins:
            response = JSONResponse(
                status_code=403,
                content={"detail": "Cross-site request rejected. Refresh the page and try again."},
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
