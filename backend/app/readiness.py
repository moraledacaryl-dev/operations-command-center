from __future__ import annotations

import os
import tempfile
from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .database import engine
from .security import load_security_settings, validate_security_settings

router = APIRouter(prefix="/api")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
DEFAULT_UPLOAD_DIR = BACKEND_ROOT / "uploads"
RELEASE_SHA = os.getenv("RELEASE_SHA", "development").strip() or "development"


def _check_database() -> tuple[bool, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # pragma: no cover - concrete driver failures vary
        return False, f"database unavailable: {type(exc).__name__}"


def _check_migrations() -> tuple[bool, str]:
    try:
        config = Config(str(ALEMBIC_INI))
        script = ScriptDirectory.from_config(config)
        expected = set(script.get_heads())
        with engine.connect() as connection:
            current = set(MigrationContext.configure(connection).get_current_heads())
        if current != expected:
            return False, f"migration mismatch: current={sorted(current)} expected={sorted(expected)}"
        return True, "ok"
    except Exception as exc:  # pragma: no cover - defensive runtime boundary
        return False, f"migration check failed: {type(exc).__name__}"


def _upload_dir() -> Path:
    configured = os.getenv("UPLOAD_DIR", "").strip()
    return Path(configured) if configured else DEFAULT_UPLOAD_DIR


def _check_storage() -> tuple[bool, str]:
    directory = _upload_dir()
    try:
        if not directory.is_dir():
            return False, f"storage directory missing: {directory}"
        with tempfile.NamedTemporaryFile(prefix=".ready-", dir=directory, delete=True) as handle:
            handle.write(b"ready")
            handle.flush()
        return True, "ok"
    except Exception as exc:
        return False, f"storage not writable: {type(exc).__name__}"


def _check_security() -> tuple[bool, str]:
    try:
        validate_security_settings(load_security_settings())
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def readiness_checks() -> dict[str, dict[str, object]]:
    checks = {
        "database": _check_database(),
        "migrations": _check_migrations(),
        "storage": _check_storage(),
        "security": _check_security(),
    }
    return {
        name: {"ok": ok, "detail": detail}
        for name, (ok, detail) in checks.items()
    }


@router.get("/livez")
def livez():
    return {"status": "ok", "app": "Manager Operations Command Center", "release_sha": RELEASE_SHA}


@router.get("/readyz")
def readyz():
    checks = readiness_checks()
    ok = all(bool(check["ok"]) for check in checks.values())
    payload = {
        "status": "ok" if ok else "not_ready",
        "ready": ok,
        "release_sha": RELEASE_SHA,
        "checks": checks,
    }
    return JSONResponse(status_code=200 if ok else 503, content=payload)
