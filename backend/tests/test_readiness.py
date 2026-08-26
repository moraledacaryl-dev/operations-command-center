from pathlib import Path

from app import readiness


def test_livez_is_independent_of_dependencies():
    assert readiness.livez() == {
        "status": "ok",
        "app": "Manager Operations Command Center",
    }


def test_readyz_returns_503_when_any_dependency_is_unsafe(monkeypatch):
    monkeypatch.setattr(
        readiness,
        "readiness_checks",
        lambda: {
            "database": {"ok": True, "detail": "ok"},
            "migrations": {"ok": False, "detail": "migration mismatch"},
            "storage": {"ok": True, "detail": "ok"},
            "security": {"ok": True, "detail": "ok"},
        },
    )

    response = readiness.readyz()
    assert response.status_code == 503
    assert b'"ready":false' in response.body
    assert b'"migrations":{"ok":false' in response.body


def test_readyz_returns_200_only_when_every_check_is_safe(monkeypatch):
    monkeypatch.setattr(
        readiness,
        "readiness_checks",
        lambda: {
            "database": {"ok": True, "detail": "ok"},
            "migrations": {"ok": True, "detail": "ok"},
            "storage": {"ok": True, "detail": "ok"},
            "security": {"ok": True, "detail": "ok"},
        },
    )

    response = readiness.readyz()
    assert response.status_code == 200
    assert b'"ready":true' in response.body


def test_storage_check_fails_when_directory_is_missing(monkeypatch, tmp_path):
    missing = tmp_path / "missing"
    monkeypatch.setattr(readiness, "_upload_dir", lambda: missing)

    ok, detail = readiness._check_storage()
    assert ok is False
    assert "storage directory missing" in detail


def test_storage_check_confirms_directory_is_writable(monkeypatch, tmp_path):
    directory = Path(tmp_path)
    monkeypatch.setattr(readiness, "_upload_dir", lambda: directory)

    ok, detail = readiness._check_storage()
    assert ok is True
    assert detail == "ok"
