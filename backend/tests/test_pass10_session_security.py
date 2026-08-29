import asyncio
import json
import time

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base
from app.session_lifecycle import SessionLifecycleMiddleware, _sign
import app.session_lifecycle as lifecycle


def run(coro):
    return asyncio.run(coro)


def make_scope(path, method="GET", headers=None):
    return {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers or [],
        "client": ("127.0.0.1", 12345),
    }


async def call(middleware, scope, body=b""):
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

    await middleware(scope, receive, send)
    start = next(item for item in messages if item["type"] == "http.response.start")
    payload = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
    return start, payload


def test_browser_login_hides_bearer_cookie_authenticates_and_logout_revokes(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0"))

    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(lifecycle, "SessionLocal", TestSession)

    with TestSession() as db:
        dept = models.Department(name="Pass 10", short_name="P10")
        db.add(dept)
        db.flush()
        user = models.User(
            name="Pass 10 Owner",
            email="pass10@example.invalid",
            role="owner",
            department_id=dept.id,
            is_active=True,
        )
        db.add(user)
        db.commit()
        user_id = user.id

    raw_token = _sign({
        "sub": user_id,
        "role": "owner",
        "exp": int(time.time()) + 600,
    })
    protected_headers = []

    async def inner(scope, receive, send):
        if scope["path"] == "/api/auth/login":
            data = json.dumps({"id": user_id, "role": "owner", "token": raw_token}).encode()
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())],
            })
            await send({"type": "http.response.body", "body": data})
            return
        protected_headers.extend(scope.get("headers", []))
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b'{"ok":true}'})

    middleware = SessionLifecycleMiddleware(inner)

    start, body = run(call(
        middleware,
        make_scope("/api/auth/login", "POST", [(b"content-type", b"application/json")]),
        b'{}',
    ))
    data = json.loads(body)
    assert "token" not in data

    response_headers = [(k.decode().lower(), v.decode()) for k, v in start["headers"]]
    cookie_header = next(value for key, value in response_headers if key == "set-cookie")
    assert "HttpOnly" in cookie_header
    cookie_pair = cookie_header.split(";", 1)[0]
    issued_token = cookie_pair.split("=", 1)[1]
    assert issued_token not in body.decode()

    start, _ = run(call(
        middleware,
        make_scope("/api/auth/me", headers=[(b"cookie", cookie_pair.encode())]),
    ))
    assert start["status"] == 200
    assert any(
        key.lower() == b"authorization" and value.startswith(b"Bearer ")
        for key, value in protected_headers
    )

    start, _ = run(call(
        middleware,
        make_scope("/api/auth/logout", "POST", [(b"cookie", cookie_pair.encode())]),
    ))
    assert start["status"] == 200

    with TestSession() as db:
        version = db.execute(
            text("SELECT session_version FROM users WHERE id = :id"),
            {"id": user_id},
        ).scalar_one()
        assert version == 1

    # A copied pre-logout bearer is now rejected even though its signature and
    # expiry remain valid.
    start, _ = run(call(
        middleware,
        make_scope("/api/auth/me", headers=[(b"authorization", f"Bearer {issued_token}".encode())]),
    ))
    assert start["status"] == 401
