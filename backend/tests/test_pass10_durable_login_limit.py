import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.login_rate_limit import DatabaseLoginFailureStore, LoginRateLimitSettings
import app.login_rate_limit as rate_limit


def run(coro):
    return asyncio.run(coro)


def test_database_login_limit_state_is_shared_across_instances(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(rate_limit, "SessionLocal", TestSession)

    settings = LoginRateLimitSettings(max_failures=2, window_seconds=60, block_seconds=30)
    first_worker = DatabaseLoginFailureStore(settings)
    second_worker = DatabaseLoginFailureStore(settings)
    key = ("shared@example.invalid", "203.0.113.9")

    run(first_worker.record_failure(key))
    run(first_worker.record_failure(key))

    assert run(second_worker.retry_after(key)) > 0
    run(second_worker.reset(key))
    assert run(first_worker.retry_after(key)) == 0
