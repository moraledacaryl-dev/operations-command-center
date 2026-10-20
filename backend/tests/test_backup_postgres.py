"""Regression coverage for credential-safe, atomic production database backups."""

from pathlib import Path
import stat
import subprocess

import pytest

from scripts.backup_postgres import backup_postgres


def test_backup_hides_password_from_process_arguments_and_publishes_private_dump(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setenv("DATABASE_URL", "postgresql://should-not-leak")
    monkeypatch.setenv("PGPASSWORD", "outdated-value")
    seen = {}

    def fake_run(command, *, check, env):
        seen["command"] = command
        seen["env"] = env
        assert check is True
        temp_path = Path(next(arg.removeprefix("--file=") for arg in command if arg.startswith("--file=")))
        assert stat.S_IMODE(temp_path.stat().st_mode) == 0o600
        temp_path.write_bytes(b"PGDMP-fixture")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)
    destination = tmp_path / "database.dump"
    backup_postgres(
        "postgresql+psycopg2://backup:p%40ssw0rd@localhost:5432/operations",
        destination,
    )

    assert destination.read_bytes() == b"PGDMP-fixture"
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600
    assert seen["command"][0] == "pg_dump"
    assert "--dbname=postgresql://backup@localhost:5432/operations" in seen["command"]
    assert "p@ssw0rd" not in " ".join(seen["command"])
    assert seen["env"]["PGPASSWORD"] == "p@ssw0rd"
    assert "DATABASE_URL" not in seen["env"]
    assert not list(tmp_path.glob("*.tmp"))


def test_failed_backup_preserves_previous_dump_and_removes_partial_file(monkeypatch, tmp_path):
    destination = tmp_path / "database.dump"
    destination.write_bytes(b"prior-good-backup")

    def failing_run(command, *, check, env):
        temporary = Path(next(arg.removeprefix("--file=") for arg in command if arg.startswith("--file=")))
        temporary.write_bytes(b"partial")
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(subprocess, "run", failing_run)
    with pytest.raises(subprocess.CalledProcessError):
        backup_postgres("postgresql://backup:secret@localhost/operations", destination)

    assert destination.read_bytes() == b"prior-good-backup"
    assert not list(tmp_path.glob("*.tmp"))


def test_empty_backup_is_rejected_without_publishing(monkeypatch, tmp_path):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda command, *, check, env: subprocess.CompletedProcess(command, 0),
    )
    with pytest.raises(RuntimeError, match="empty"):
        backup_postgres("postgresql://backup:secret@localhost/operations", tmp_path / "empty.dump")
    assert not list(tmp_path.glob("*.tmp"))
    assert not (tmp_path / "empty.dump").exists()


def test_backup_refuses_non_postgresql_urls(tmp_path):
    with pytest.raises(ValueError, match="PostgreSQL"):
        backup_postgres("sqlite:////tmp/not-production.db", tmp_path / "database.dump")
