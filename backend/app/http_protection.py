from __future__ import annotations

import os
import time
import uuid
from collections import defaultdict, deque
from threading import Lock
from typing import Deque

from fastapi import Request
from starlette.responses import JSONResponse


MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(12 * 1024 * 1024)))
LOGIN_WINDOW_SECONDS = int(os.getenv("LOGIN_RATE_WINDOW_SECONDS", "300"))
LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_RATE_MAX_ATTEMPTS", "10"))
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "true").strip().lower() in {"1", "true", "yes", "on"}


class LoginRateLimiter:
    def __init__(self, max_attempts: int = LOGIN_MAX_ATTEMPTS, window_seconds: int = LOGIN_WINDOW_SECONDS):
        self.max_attempts = max(1, max_attempts)
        self.window_seconds = max(1, window_seconds)
        self._attempts: dict[str, Deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            bucket = self._attempts[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.max_attempts:
                retry_after = max(1, int(self.window_seconds - (now - bucket[0])))
                return False, retry_after
            bucket.append(now)
            return True, 0


login_limiter = LoginRateLimiter()


def request_id(request: Request) -> str:
    incoming = (request.headers.get("X-Request-Id") or "").strip()
    if incoming and len(incoming) <= 128 and all(ch.isalnum() or ch in "-_.:" for ch in incoming):
        return incoming
    return uuid.uuid4().hex


def client_key(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
        real_ip = request.headers.get("X-Real-IP", "").strip()
        if real_ip:
            return real_ip
    return request.client.host if request.client else "unknown"


async def enforce_request_boundary(request: Request):
    if request.method in {"POST", "PUT", "PATCH"}:
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                if int(raw_length) > MAX_REQUEST_BYTES:
                    return JSONResponse(status_code=413, content={"detail": "Request body is too large."})
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header."})

    if request.method == "POST" and request.url.path == "/api/auth/login":
        allowed, retry_after = login_limiter.allow(client_key(request))
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many login attempts. Try again later."},
                headers={"Retry-After": str(retry_after)},
            )
    return None
