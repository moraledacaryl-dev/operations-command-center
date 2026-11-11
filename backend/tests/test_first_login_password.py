import json
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.auth import hash_password
from app.routers.api import (AdminResetPasswordPayload, AdminUserCreatePayload,
                             PasswordChangePayload, admin_reset_password, change_password)
from app.routers.privacy import create_user
from app.session_lifecycle import SessionLifecycleMiddleware, _sign
import app.session_lifecycle as lifecycle
from test_pass10_session_security import call, make_scope, run


def test_creation_reset_and_password_change(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'))
    with sessionmaker(bind=engine, expire_on_commit=False)() as db:
        owner = models.User(name='Owner', role='owner', is_active=True)
        manager = models.User(name='Manager', role='manager', is_active=True)
        db.add_all([owner, manager]); db.commit()
        temporary = 'Test-Temporary-4321!'
        created = create_user(AdminUserCreatePayload(name='Employee', email='employee', role='staff', password=temporary), user=owner, db=db)
        employee = db.get(models.User, created.id)
        assert created.must_change_password and employee.must_change_password
        with pytest.raises(HTTPException):
            change_password(PasswordChangePayload(current_password=temporary, new_password=temporary), user=employee, db=db)
        assert employee.must_change_password
        change_password(PasswordChangePayload(current_password=temporary, new_password='Fresh-Password-5632!'), user=employee, db=db)
        assert not employee.must_change_password
        with pytest.raises(HTTPException) as denied:
            admin_reset_password(employee.id, AdminResetPasswordPayload(new_password=temporary), user=manager, db=db)
        assert denied.value.status_code == 403
        admin_reset_password(employee.id, AdminResetPasswordPayload(new_password=temporary), user=owner, db=db)
        assert employee.must_change_password
        assert db.execute(text('SELECT session_version FROM users WHERE id=:id'), {'id': employee.id}).scalar_one() == 2
    engine.dispose()


def test_temporary_password_restricts_cookie_and_bearer_sessions(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'))
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(lifecycle, 'SessionLocal', Session)
    with Session() as db:
        employee = models.User(name='Employee', role='staff', is_active=True, must_change_password=True, password_hash=hash_password('Test-Temporary-4321!'))
        db.add(employee); db.commit(); user_id = employee.id
    token = _sign({'sub': user_id, 'iat': int(time.time()), 'exp': int(time.time()) + 600, 'sv': 0})
    async def inner(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})
    middleware = SessionLifecycleMiddleware(inner)
    for headers in [[(b'authorization', f'Bearer {token}'.encode())], [(b'cookie', f'{lifecycle.COOKIE_NAME}={token}'.encode())]]:
        start, body = run(call(middleware, make_scope('/api/tasks', headers=headers)))
        assert start['status'] == 428 and json.loads(body)['code'] == 'password_change_required'
        for path in ['/api/auth/me', '/api/auth/change-password']:
            start, _ = run(call(middleware, make_scope(path, headers=headers)))
            assert start['status'] == 200
    engine.dispose()
