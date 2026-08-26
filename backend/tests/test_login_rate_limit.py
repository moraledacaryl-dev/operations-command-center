import asyncio
import json

from app.login_rate_limit import (
    LoginRateLimitMiddleware,
    LoginRateLimitSettings,
    client_ip,
)


def run(coro):
    return asyncio.run(coro)


def scope(ip="10.0.0.5", forwarded=None):
    headers = [(b"content-type", b"application/json")]
    if forwarded:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    return {
        "type": "http",
        "method": "POST",
        "path": "/api/auth/login",
        "headers": headers,
        "client": (ip, 12345),
    }


async def request(middleware, request_scope, email, password):
    body = json.dumps({"email": email, "password": password}).encode()
    received = False

    async def receive():
        nonlocal received
        if received:
            return {"type": "http.request", "body": b"", "more_body": False}
        received = True
        return {"type": "http.request", "body": body, "more_body": False}

    messages = []

    async def send(message):
        messages.append(message)

    await middleware(request_scope, receive, send)
    start = next(message for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
    headers = {key.decode().lower(): value.decode() for key, value in start.get("headers", [])}
    return start["status"], headers, response_body


def auth_app():
    async def app(request_scope, receive, send):
        message = await receive()
        payload = json.loads(message.get("body", b"{}"))
        password = payload.get("password")
        if password == "good":
            status = 200
            body = b'{"token":"ok"}'
        elif password == "unset":
            status = 403
            body = b'{"detail":"Password is not set"}'
        else:
            status = 401
            body = b'{"detail":"Invalid login"}'
        await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})

    return app


def test_failed_logins_are_limited_by_normalized_email_and_ip():
    settings = LoginRateLimitSettings(max_failures=2, window_seconds=60, block_seconds=30)
    middleware = LoginRateLimitMiddleware(auth_app(), settings=settings)
    s = scope()

    assert run(request(middleware, s, " User@Example.COM ", "bad"))[0] == 401
    assert run(request(middleware, s, "user@example.com", "bad"))[0] == 401

    status, headers, body = run(request(middleware, s, "USER@example.com", "bad"))
    assert status == 429
    assert int(headers["retry-after"]) >= 1
    assert b"Too many failed sign-in attempts" in body


def test_success_resets_prior_failure_state():
    settings = LoginRateLimitSettings(max_failures=2, window_seconds=60, block_seconds=30)
    middleware = LoginRateLimitMiddleware(auth_app(), settings=settings)
    s = scope()

    assert run(request(middleware, s, "user@example.com", "bad"))[0] == 401
    assert run(request(middleware, s, "user@example.com", "good"))[0] == 200
    assert run(request(middleware, s, "user@example.com", "bad"))[0] == 401
    assert run(request(middleware, s, "user@example.com", "bad"))[0] == 401
    assert run(request(middleware, s, "user@example.com", "bad"))[0] == 429


def test_non_authentication_403_does_not_increment_failures():
    settings = LoginRateLimitSettings(max_failures=1, window_seconds=60, block_seconds=30)
    middleware = LoginRateLimitMiddleware(auth_app(), settings=settings)
    s = scope()

    assert run(request(middleware, s, "user@example.com", "unset"))[0] == 403
    assert run(request(middleware, s, "user@example.com", "good"))[0] == 200


def test_rate_limit_key_separates_client_ip_and_email():
    settings = LoginRateLimitSettings(max_failures=1, window_seconds=60, block_seconds=30)
    middleware = LoginRateLimitMiddleware(auth_app(), settings=settings)

    assert run(request(middleware, scope("10.0.0.5"), "a@example.com", "bad"))[0] == 401
    assert run(request(middleware, scope("10.0.0.5"), "a@example.com", "bad"))[0] == 429
    assert run(request(middleware, scope("10.0.0.6"), "a@example.com", "good"))[0] == 200
    assert run(request(middleware, scope("10.0.0.5"), "b@example.com", "good"))[0] == 200


def test_forwarded_headers_are_ignored_by_default():
    settings = LoginRateLimitSettings()
    assert client_ip(scope("127.0.0.1", "203.0.113.10"), settings) == "127.0.0.1"


def test_forwarded_headers_require_explicit_trusted_immediate_proxy():
    trusted = LoginRateLimitSettings(
        trust_proxy_headers=True,
        trusted_proxy_ips=frozenset({"127.0.0.1"}),
    )
    untrusted_peer = LoginRateLimitSettings(
        trust_proxy_headers=True,
        trusted_proxy_ips=frozenset({"10.0.0.1"}),
    )

    assert client_ip(scope("127.0.0.1", "203.0.113.10, 127.0.0.1"), trusted) == "203.0.113.10"
    assert client_ip(scope("127.0.0.1", "203.0.113.10"), untrusted_peer) == "127.0.0.1"
