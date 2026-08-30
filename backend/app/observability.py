from __future__ import annotations

import json
import logging
import os
import time
from collections import Counter
from threading import Lock

from .clock import utc_now


logger = logging.getLogger("operations.request")
RELEASE_SHA = os.getenv("RELEASE_SHA", "development").strip() or "development"


class Metrics:
    def __init__(self):
        self._lock = Lock()
        self.requests = Counter()
        self.duration_ms = Counter()
        self.login_failures = 0
        self.login_blocks = 0
        self.workflow_conflicts = 0

    def observe(self, method: str, route: str, status: int, duration_ms: float) -> None:
        key = (method, route, str(status))
        with self._lock:
            self.requests[key] += 1
            self.duration_ms[key] += duration_ms
            if route == "/api/auth/login" and status == 401:
                self.login_failures += 1
            if route == "/api/auth/login" and status == 429:
                self.login_blocks += 1
            if route.startswith("/api/workflow/") and status == 409:
                self.workflow_conflicts += 1

    def prometheus(self) -> str:
        lines = [
            "# HELP operations_http_requests_total HTTP responses by route template and status.",
            "# TYPE operations_http_requests_total counter",
        ]
        with self._lock:
            for (method, route, status), value in sorted(self.requests.items()):
                labels = f'method="{_label(method)}",route="{_label(route)}",status="{_label(status)}"'
                lines.append(f"operations_http_requests_total{{{labels}}} {value}")
            lines.extend([
                "# HELP operations_http_request_duration_ms_total Accumulated response duration in milliseconds.",
                "# TYPE operations_http_request_duration_ms_total counter",
            ])
            for (method, route, status), value in sorted(self.duration_ms.items()):
                labels = f'method="{_label(method)}",route="{_label(route)}",status="{_label(status)}"'
                lines.append(f"operations_http_request_duration_ms_total{{{labels}}} {value:.3f}")
            lines.extend([
                "# TYPE operations_login_failures_total counter",
                f"operations_login_failures_total {self.login_failures}",
                "# TYPE operations_login_blocks_total counter",
                f"operations_login_blocks_total {self.login_blocks}",
                "# TYPE operations_workflow_conflicts_total counter",
                f"operations_workflow_conflicts_total {self.workflow_conflicts}",
            ])
        return "\n".join(lines) + "\n"


def _label(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _headers(scope) -> dict[str, str]:
    return {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}


def _auth_mode(headers: dict[str, str]) -> str:
    if headers.get("authorization", "").startswith("Bearer "):
        return "bearer"
    if headers.get("x-integration-api-key"):
        return "integration_key"
    if "operations_session=" in headers.get("cookie", ""):
        return "session_cookie"
    return "anonymous"


metrics = Metrics()


class RequestObservabilityMiddleware:
    """Record low-cardinality metrics and structured logs without request data."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500
        request_id = ""

        async def observed_send(message):
            nonlocal status, request_id
            if message.get("type") == "http.response.start":
                status = int(message.get("status", 500))
                response_headers = _headers({"headers": message.get("headers", [])})
                request_id = response_headers.get("x-request-id", "")
            await send(message)

        try:
            await self.app(scope, receive, observed_send)
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            route = getattr(scope.get("route"), "path", None) or str(scope.get("path", "unknown"))[:256]
            method = str(scope.get("method", ""))[:12]
            metrics.observe(method, route, status, duration_ms)
            headers = _headers(scope)
            event = {
                "event": "http_response",
                "timestamp": utc_now().isoformat().replace("+00:00", "Z"),
                "release_sha": RELEASE_SHA,
                "request_id": request_id or headers.get("x-request-id", ""),
                "method": method,
                "route": route,
                "status": status,
                "duration_ms": round(duration_ms, 3),
                "auth_mode": _auth_mode(headers),
            }
            logger.info(json.dumps(event, separators=(",", ":"), sort_keys=True))


__all__ = ["RequestObservabilityMiddleware", "metrics"]
