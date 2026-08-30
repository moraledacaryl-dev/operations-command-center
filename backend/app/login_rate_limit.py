from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Protocol

from sqlalchemy import Column, Index, Integer, String, Table, delete, func, select
from starlette.responses import JSONResponse

from .auth import normalize_email
from .client_ip import TrustedProxySettings, trusted_client_ip
from .clock import UTCDateTime, utc_now
from .database import Base, SessionLocal


login_failure_events = Table(
    "login_failure_events",
    Base.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("key_hash", String(64), nullable=False),
    Column("occurred_at", UTCDateTime, nullable=False),
    Index("ix_login_failure_events_key_time", "key_hash", "occurred_at"),
    extend_existing=True,
)


@dataclass(frozen=True)
class LoginRateLimitSettings:
    max_failures: int = 5
    window_seconds: int = 15 * 60
    block_seconds: int = 15 * 60
    trust_proxy_headers: bool = False
    trusted_proxy_ips: frozenset[str] = frozenset()

    @classmethod
    def from_env(cls) -> "LoginRateLimitSettings":
        trusted = frozenset(
            value.strip()
            for value in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
            if value.strip()
        )
        return cls(
            max_failures=max(1, int(os.getenv("LOGIN_MAX_FAILURES", "5"))),
            window_seconds=max(1, int(os.getenv("LOGIN_FAILURE_WINDOW_SECONDS", "900"))),
            block_seconds=max(1, int(os.getenv("LOGIN_BLOCK_SECONDS", "900"))),
            trust_proxy_headers=os.getenv("TRUST_PROXY_HEADERS", "false").strip().lower() == "true",
            trusted_proxy_ips=trusted,
        )


class LoginFailureStore(Protocol):
    async def retry_after(self, key: tuple[str, str]) -> int: ...
    async def record_failure(self, key: tuple[str, str]) -> None: ...
    async def reset(self, key: tuple[str, str]) -> None: ...


def _key_hash(key: tuple[str, str]) -> str:
    email, ip = key
    return hashlib.sha256(f"{email}\0{ip}".encode()).hexdigest()


class DatabaseLoginFailureStore:
    """Durable login failure events shared by all application workers."""

    def __init__(self, settings: LoginRateLimitSettings, clock: Callable[[], datetime] | None = None):
        self.settings = settings
        self.clock = clock or utc_now

    async def retry_after(self, key: tuple[str, str]) -> int:
        now = self.clock()
        cutoff = now - timedelta(seconds=self.settings.window_seconds)
        key_hash = _key_hash(key)
        with SessionLocal() as db:
            db.execute(delete(login_failure_events).where(
                login_failure_events.c.key_hash == key_hash,
                login_failure_events.c.occurred_at <= cutoff,
            ))
            count, latest = db.execute(
                select(func.count(), func.max(login_failure_events.c.occurred_at)).where(
                    login_failure_events.c.key_hash == key_hash
                )
            ).one()
            if int(count or 0) < self.settings.max_failures or latest is None:
                db.commit()
                return 0
            blocked_until = latest + timedelta(seconds=self.settings.block_seconds)
            if blocked_until <= now:
                db.execute(delete(login_failure_events).where(login_failure_events.c.key_hash == key_hash))
                db.commit()
                return 0
            db.commit()
            return max(1, math.ceil((blocked_until - now).total_seconds()))

    async def record_failure(self, key: tuple[str, str]) -> None:
        with SessionLocal.begin() as db:
            db.execute(login_failure_events.insert().values(
                key_hash=_key_hash(key),
                occurred_at=self.clock(),
            ))

    async def reset(self, key: tuple[str, str]) -> None:
        with SessionLocal.begin() as db:
            db.execute(delete(login_failure_events).where(
                login_failure_events.c.key_hash == _key_hash(key)
            ))


class MemoryLoginFailureStore:
    """Deterministic unit-test store; production uses the database store."""

    def __init__(self, settings: LoginRateLimitSettings, clock: Callable[[], float] = time.monotonic):
        self.settings = settings
        self.clock = clock
        self._failures: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._blocked_until: dict[tuple[str, str], float] = {}
        self._lock = asyncio.Lock()

    def _prune(self, key: tuple[str, str], now: float) -> None:
        failures = self._failures.get(key)
        if not failures:
            return
        cutoff = now - self.settings.window_seconds
        while failures and failures[0] <= cutoff:
            failures.popleft()
        if not failures:
            self._failures.pop(key, None)

    async def retry_after(self, key: tuple[str, str]) -> int:
        async with self._lock:
            now = self.clock()
            self._prune(key, now)
            until = self._blocked_until.get(key, 0)
            if until <= now:
                self._blocked_until.pop(key, None)
                return 0
            return max(1, math.ceil(until - now))

    async def record_failure(self, key: tuple[str, str]) -> None:
        async with self._lock:
            now = self.clock()
            self._prune(key, now)
            failures = self._failures[key]
            failures.append(now)
            if len(failures) >= self.settings.max_failures:
                self._blocked_until[key] = now + self.settings.block_seconds

    async def reset(self, key: tuple[str, str]) -> None:
        async with self._lock:
            self._failures.pop(key, None)
            self._blocked_until.pop(key, None)


def client_ip(scope, settings: LoginRateLimitSettings) -> str:
    return trusted_client_ip(
        scope,
        TrustedProxySettings(
            trust_proxy_headers=settings.trust_proxy_headers,
            trusted_proxy_ips=settings.trusted_proxy_ips,
        ),
    )


async def _read_body(receive) -> bytes:
    chunks: list[bytes] = []
    more = True
    while more:
        message = await receive()
        if message.get("type") != "http.request":
            continue
        chunks.append(message.get("body", b""))
        more = bool(message.get("more_body"))
    return b"".join(chunks)


def _email_from_body(body: bytes) -> str | None:
    try:
        payload = json.loads(body or b"{}")
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    email = normalize_email(payload.get("email"))
    return email or None


class LoginRateLimitMiddleware:
    """Rate-limit failed password authentication by normalized email + trusted client IP."""

    def __init__(
        self,
        app,
        settings: LoginRateLimitSettings | None = None,
        store: LoginFailureStore | None = None,
    ):
        self.app = app
        self.settings = settings or LoginRateLimitSettings.from_env()
        self.store = store or DatabaseLoginFailureStore(self.settings)

    async def __call__(self, scope, receive, send):
        if (
            scope.get("type") != "http"
            or scope.get("method", "GET").upper() != "POST"
            or scope.get("path", "") != "/api/auth/login"
        ):
            await self.app(scope, receive, send)
            return

        body = await _read_body(receive)
        email = _email_from_body(body)
        if not email:
            sent = False

            async def replay_invalid():
                nonlocal sent
                if sent:
                    return {"type": "http.request", "body": b"", "more_body": False}
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}

            await self.app(scope, replay_invalid, send)
            return

        key = (email, client_ip(scope, self.settings))
        retry_after = await self.store.retry_after(key)
        if retry_after:
            response = JSONResponse(
                status_code=429,
                content={"detail": "Too many failed sign-in attempts. Try again later."},
                headers={"Retry-After": str(retry_after), "Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return

        sent = False

        async def replay():
            nonlocal sent
            if sent:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        status_code = 500

        async def inspect_response(message):
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = int(message.get("status", 500))
            await send(message)

        await self.app(scope, replay, inspect_response)

        if status_code == 401:
            await self.store.record_failure(key)
        elif 200 <= status_code < 300:
            await self.store.reset(key)
