"""The production deployment gate must never manufacture business records."""
import importlib.util
from pathlib import Path

import pytest


@pytest.fixture
def smoke(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts/release_smoke.py"
    spec = importlib.util.spec_from_file_location("safe_release_smoke", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("OPERATIONS_SMOKE_EMAIL", "existing-operator@example.invalid")
    monkeypatch.setenv("OPERATIONS_SMOKE_PASSWORD", "fixture-only")
    monkeypatch.setattr(module, "REQUIRE_LOGIN", True)
    monkeypatch.setattr(module, "EXPECTED_SHA", "a" * 40)
    if hasattr(module, "SessionLocal"):
        monkeypatch.setattr(module, "SessionLocal", lambda: pytest.fail("Production smoke must not open a database session"))
    return module


def response(path):
    if path == "/livez":
        return 200, {"release_sha": "a" * 40}, {}
    if path == "/readyz":
        return 200, {"ready": True, "release_sha": "a" * 40}, {}
    if path == "/auth/login":
        return 200, {"id": 7}, {"Set-Cookie": "operations_session=private; HttpOnly; Secure; Path=/"}
    if path == "/auth/me":
        return 200, {"id": 7, "role": "owner"}, {}
    pytest.fail("Unexpected production workflow request")


def test_production_gate_uses_only_health_existing_login_and_authenticated_read(smoke, monkeypatch):
    calls = []
    def request(method, path, **kwargs):
        calls.append((method, path))
        if path == "/auth/me":
            assert kwargs["cookie"] == "operations_session=private"
        return response(path)
    monkeypatch.setattr(smoke, "request", request)
    smoke.main()
    assert calls == [("GET", "/livez"), ("GET", "/readyz"), ("POST", "/auth/login"), ("GET", "/auth/me")]


@pytest.mark.parametrize("fault", ["wrong_sha", "unready", "bearer_exposed", "insecure_cookie", "missing_identity"])
def test_production_gate_fails_closed(smoke, monkeypatch, fault):
    def request(method, path, **kwargs):
        status, payload, headers = response(path)
        if fault == "wrong_sha" and path == "/livez":
            payload["release_sha"] = "b" * 40
        if fault == "unready" and path == "/readyz":
            payload["ready"] = False
        if fault == "bearer_exposed" and path == "/auth/login":
            payload["token"] = "must-not-be-exposed"
        if fault == "insecure_cookie" and path == "/auth/login":
            headers["Set-Cookie"] = "operations_session=private; Path=/"
        if fault == "missing_identity" and path == "/auth/me":
            payload = {}
        return status, payload, headers
    monkeypatch.setattr(smoke, "request", request)
    with pytest.raises(RuntimeError):
        smoke.main()


def test_required_existing_credentials_cannot_be_skipped(smoke, monkeypatch):
    monkeypatch.delenv("OPERATIONS_SMOKE_PASSWORD")
    monkeypatch.setattr(smoke, "request", lambda method, path, **kwargs: response(path))
    with pytest.raises(RuntimeError, match="required"):
        smoke.main()
