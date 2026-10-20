import pytest

from app.security import load_security_settings, validate_security_settings
from app import seed


def test_production_rejects_demo_seed(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SESSION_SECRET", "s" * 48)
    monkeypatch.setenv("INTEGRATION_API_KEY", "k" * 48)
    monkeypatch.setenv("ALLOW_DEMO_SEED", "true")
    with pytest.raises(RuntimeError, match="ALLOW_DEMO_SEED"):
        validate_security_settings(load_security_settings())


def test_production_seed_never_creates_demo_records(monkeypatch):
    class DatabaseThatMustNotBeRead:
        def query(self, *args):
            raise AssertionError("Production demo seeding must not query or write")
    monkeypatch.setattr(seed, "ENVIRONMENT", "production")
    monkeypatch.setattr(seed, "ALLOW_DEMO_SEED", True)
    # Explicit production guard must precede the first database query.
    seed.seed_if_empty(DatabaseThatMustNotBeRead())
