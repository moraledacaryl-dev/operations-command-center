import time
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app import models
from app.routers.api import AdminResetPasswordPayload, AdminUserCreatePayload, admin_reset_password
from app.routers.privacy import create_user
from app.session_lifecycle import SessionLifecycleMiddleware, _sign
from app.training_environment import is_isolated_training
from app.user_dto import current_user
import app.session_lifecycle as lifecycle
from test_pass10_session_security import call, make_scope, run


def test_training_password_exception_is_local_and_database_scoped(tmp_path, monkeypatch):
    path = tmp_path / 'operations_training_demo_test.sqlite'
    engine = create_engine('sqlite:///' + str(path))
    models.Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'))
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setenv('ENVIRONMENT', 'local')
    monkeypatch.setattr(lifecycle, 'SessionLocal', Session)
    with Session() as db:
        owner = models.User(name='Owner', role='owner', is_active=True)
        db.add(owner); db.commit()
        result = create_user(AdminUserCreatePayload(name='Demo employee', email='demo', role='staff', password='A-Demo-Password-123!'), user=owner, db=db)
        employee = db.get(models.User, result.id)
        assert not employee.must_change_password
        admin_reset_password(employee.id, AdminResetPasswordPayload(new_password='A-Fresh-Password-123!'), user=owner, db=db)
        assert not employee.must_change_password
        employee.must_change_password = True
        db.commit()
        assert not current_user(db, employee).must_change_password
        assert is_isolated_training(db)
        user_id = employee.id
    token = _sign({'sub': user_id, 'iat': int(time.time()), 'exp': int(time.time()) + 600, 'sv': 1})
    async def inner(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': b'{}'})
    start, _ = run(call(SessionLifecycleMiddleware(inner), make_scope('/api/tasks', headers=[(b'authorization', f'Bearer {token}'.encode())])))
    assert start['status'] == 200
    monkeypatch.setenv('ENVIRONMENT', 'production')
    with Session() as db:
        assert not is_isolated_training(db)
        assert current_user(db, db.get(models.User, user_id)).must_change_password
    start, _ = run(call(SessionLifecycleMiddleware(inner), make_scope('/api/tasks', headers=[(b'authorization', f'Bearer {token}'.encode())])))
    assert start['status'] == 428
    engine.dispose()
