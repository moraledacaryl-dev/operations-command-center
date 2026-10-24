"""Isolated restore-drill guards; no Docker/database needed for unit tests."""
from __future__ import annotations

import hashlib
import importlib
import io
import json
import re
import sys
import tarfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
drill = importlib.import_module("isolated_restore_drill")


def pack(tmp_path: Path, records: dict[str, tuple[bytes | None, str]]) -> Path:
    path = tmp_path / "uploads.tar.gz"
    with tarfile.open(path, "w:gz") as archive:
        for name, (data, kind) in records.items():
            entry = tarfile.TarInfo(name)
            if kind == "directory":
                entry.type = tarfile.DIRTYPE
            elif kind == "link":
                entry.type = tarfile.SYMTYPE
                entry.linkname = "/etc/passwd"
            elif kind == "device":
                entry.type = tarfile.CHRTYPE
            else:
                entry.size = len(data or b"")
            archive.addfile(entry, io.BytesIO(data or b"") if kind == "file" else None)
    return path


def test_docker_contract_never_connects_to_production():
    args = drill.container_start_args("operations-restore-012345abcdef")
    assert args[:3] == ["docker", "run", "--detach"]
    assert "--network=none" in args
    assert "--pull=never" in args
    assert "--rm" in args
    assert "--memory=2g" in args
    assert "--pids-limit=128" in args
    assert not any("DATABASE_URL" in part or "PGPASSWORD" in part for part in args)
    assert not any(part in {"--mount", "-v", "--volume", "-p", "--publish", "--network=host"} for part in args)
    assert args[-1] == "postgres:16-alpine"


def test_disallows_arbitrary_containers_or_images():
    with pytest.raises(drill.DrillFailure):
        drill.container_start_args("production-database")
    with pytest.raises(drill.DrillFailure):
        drill.container_start_args("operations-restore-012345abcdef", "postgres:latest")


def test_every_upload_is_privately_materialized_and_reread(tmp_path):
    path = pack(tmp_path, {
        ".": (None, "directory"),
        "./documents": (None, "directory"),
        "./documents/sample.pdf": (b"PDF fixture", "file"),
        "./documents/zero.txt": (b"", "file"),
    })
    result = drill.restore_uploads(path, max_bytes=100)
    assert result["all_upload_members_restored_and_verified"] is True
    assert result["files_restored"] == 2
    assert result["upload_bytes_restored"] == len(b"PDF fixture")
    assert result["attachment_sample_present"] is True


@pytest.mark.parametrize("name,kind", [
    ("../escape.txt", "file"),
    ("../../escape.txt", "file"),
    ("/absolute.txt", "file"),
    ("private/link", "link"),
    ("private/device", "device"),
    (r"private\escape.txt", "file"),
])
def test_unsafe_upload_members_rejected(tmp_path, name, kind):
    path = pack(tmp_path, {name: (b"x", kind)})
    with pytest.raises(drill.DrillFailure):
        drill.restore_uploads(path, max_bytes=100)


def test_rejects_upload_expansion_above_cap(tmp_path):
    path = pack(tmp_path, {"file.bin": (b"test data", "file")})
    with pytest.raises(drill.DrillFailure):
        drill.restore_uploads(path, max_bytes=4)


def test_empty_uploads_are_not_misreported_as_attachment_validation(tmp_path):
    path = pack(tmp_path, {".": (None, "directory")})
    result = drill.restore_uploads(path, max_bytes=1024)
    assert result["files_restored"] == 0
    assert result["attachment_sample_present"] is False


def test_rejects_failure_before_docker_restore(monkeypatch, tmp_path):
    monkeypatch.setattr(drill, "audit_release_recovery", lambda **_: {"status": "investigate"})
    monkeypatch.setattr(drill, "restore_database", lambda *a: pytest.fail("must not restore"))
    with pytest.raises(drill.DrillFailure):
        drill.run_drill("a" * 40, tmp_path / "current", tmp_path, max_upload_bytes=100)


def test_count_parser_accepts_only_integers(monkeypatch):
    class Result:
        returncode = 0
        stdout = b"3\n"
    monkeypatch.setattr(drill, "safe_execute", lambda _: Result())
    assert drill.query_integer("a" * 64, "SELECT 3") == 3
    Result.stdout = b"3\n4\n"
    with pytest.raises(drill.DrillFailure):
        drill.query_integer("a" * 64, "SELECT 3")


def test_main_requires_explicit_acknowledgment(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["isolated_restore_drill.py", "--expected-sha", "a" * 40])
    with pytest.raises(SystemExit) as exc:
        drill.main()
    assert exc.value.code == 2
