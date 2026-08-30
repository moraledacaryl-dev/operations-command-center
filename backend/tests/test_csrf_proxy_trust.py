import asyncio

from app.client_ip import TrustedProxySettings, trusted_client_ip
from app.csrf_protection import CsrfProtectionMiddleware


def run(coro):
    return asyncio.run(coro)


def scope(*, origin=None, forwarded_host=None):
    headers = [(b"cookie", b"operations_session=session-value")]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    if forwarded_host is not None:
        headers.extend([
            (b"x-forwarded-host", forwarded_host.encode()),
            (b"x-forwarded-proto", b"https"),
        ])
    return {
        "type": "http",
        "method": "POST",
        "path": "/api/tasks",
        "headers": headers,
        "client": ("127.0.0.1", 1234),
    }


async def invoke(middleware, request_scope):
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await middleware(request_scope, receive, send)
    return next(message["status"] for message in messages if message["type"] == "http.response.start")


def app():
    async def inner(request_scope, receive, send):
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    return inner


def test_configured_origin_is_accepted(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://operations.hiddenoasis.app")
    middleware = CsrfProtectionMiddleware(app())
    assert run(invoke(middleware, scope(origin="https://operations.hiddenoasis.app"))) == 204


def test_forwarded_host_never_expands_csrf_trust(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://operations.hiddenoasis.app")
    middleware = CsrfProtectionMiddleware(app())
    status = run(invoke(middleware, scope(
        origin="https://attacker.example",
        forwarded_host="attacker.example",
    )))
    assert status == 403


def test_missing_and_null_origin_are_rejected(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://operations.hiddenoasis.app")
    middleware = CsrfProtectionMiddleware(app())
    assert run(invoke(middleware, scope())) == 403
    assert run(invoke(middleware, scope(origin="null"))) == 403


def test_audit_and_limiter_resolver_ignores_spoofed_headers_from_untrusted_peer():
    request_scope = scope(origin="https://operations.hiddenoasis.app")
    request_scope["client"] = ("198.51.100.9", 1234)
    request_scope["headers"].append((b"x-forwarded-for", b"203.0.113.20"))
    settings = TrustedProxySettings(True, frozenset({"127.0.0.1"}))
    assert trusted_client_ip(request_scope, settings) == "198.51.100.9"
