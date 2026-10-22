"""Offline failure-case coverage for the read-only release recovery audit."""
import hashlib
import importlib.util
import io
import json
import os
import tarfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "scripts" / "certify_release_backup_readonly.py"
spec = importlib.util.spec_from_file_location("operations_recovery_audit", PATH)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
SHA = "a" * 40


def save_private(path: Path, data: bytes) -> None:
    path.write_bytes(data)
    path.chmod(0o600)


def checksum(path: Path) -> None:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    save_private(Path(str(path) + ".sha256"), f"{digest}  {path}\n".encode())


def setup_release(tmp_path: Path):
    releases = tmp_path / "app" / "releases"
    releases.mkdir(parents=True)
    release = releases / SHA
    release.mkdir()
    current = tmp_path / "app" / "current"
    current.symlink_to(release, target_is_directory=True)
    backups = tmp_path / "private-backups"
    backups.mkdir()
    db = backups / f"database-{SHA}-20261022T185815Z.dump"
    uploads = backups / f"uploads-{SHA}-20261022T185815Z.tar.gz"
    save_private(db, b"synthetic test archive; never use in production")
    with tarfile.open(uploads, "w:gz") as tar:
        info = tarfile.TarInfo("./sample.txt")
        content = b"test fixture only"
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))
    uploads.chmod(0o600)
    checksum(db)
    checksum(uploads)
    package = release / "frontend" / "package-lock.json"
    package.parent.mkdir()
    package.write_text('{"lockfileVersion": 3}\n')
    requirements = release / "backend" / "requirements.txt"
    requirements.parent.mkdir()
    requirements.write_text("pytest==8.0.0\n")
    manifest = {
        "release_sha": SHA,
        "migration_head": "0011_project_collaboration",
        "database_backup": str(db),
        "uploads_backup": str(uploads),
        "package_lock_sha256": hashlib.sha256(package.read_bytes()).hexdigest(),
        "requirements_sha256": hashlib.sha256(requirements.read_bytes()).hexdigest(),
    }
    (release / "release-manifest.json").write_text(json.dumps(manifest))
    return current, backups, db, uploads, release, manifest


def run(current: Path, backups: Path, inspector=lambda _: True):
    return audit.audit_release_recovery(
        expected_sha=SHA, current=current, backup_dir=backups,
        inspect_postgres=inspector,
    )


def test_valid_archives_and_manifest_are_read_only(tmp_path):
    current, backups, db, uploads, release, manifest = setup_release(tmp_path)
    before = [file.read_bytes() for file in (db, uploads, release / "release-manifest.json")]
    result = run(current, backups)
    assert result["status"] == "pass"
    assert result["read_only"] is True
    assert result["restore_drill_performed"] is False
    assert result["migration_downgrade_performed"] is False
    assert all(result["checks"].values())
    assert all(all(item.values()) for item in result["archives"].values())
    assert [file.read_bytes() for file in (db, uploads, release / "release-manifest.json")] == before
    raw = json.dumps(result)
    assert str(backups) not in raw
    assert "password" not in raw


@pytest.mark.parametrize("failure", [
    "wrong-sha", "missing-dump", "bad-dump-hash", "bad-upload-hash",
    "public-backup-mode", "missing-hash", "broken-pg-index",
    "bad-tar", "missing-lockfile", "altered-requirements",
    "outside-backup-dir", "symlink-dump", "missing-manifest",
])
def test_detects_release_and_backup_failures(tmp_path, failure):
    current, backups, db, uploads, release, manifest = setup_release(tmp_path)
    inspect = lambda _: True
    if failure == "wrong-sha":
        manifest["release_sha"] = "b" * 40
    elif failure == "missing-dump":
        db.unlink()
    elif failure == "bad-dump-hash":
        db.write_bytes(db.read_bytes() + b"tampered")
    elif failure == "bad-upload-hash":
        uploads.write_bytes(uploads.read_bytes() + b"tampered")
    elif failure == "public-backup-mode":
        db.chmod(0o644)
    elif failure == "missing-hash":
        Path(str(db) + ".sha256").unlink()
    elif failure == "broken-pg-index":
        inspect = lambda _: False
    elif failure == "bad-tar":
        save_private(uploads, b"not gzip")
        checksum(uploads)
    elif failure == "missing-lockfile":
        (release / "frontend" / "package-lock.json").unlink()
    elif failure == "altered-requirements":
        (release / "backend" / "requirements.txt").write_text("not original")
    elif failure == "outside-backup-dir":
        manifest["database_backup"] = str(tmp_path / db.name)
    elif failure == "symlink-dump":
        db.unlink()
        outside = tmp_path / "outside"
        save_private(outside, b"not a secure dump")
        db.symlink_to(outside)
    elif failure == "missing-manifest":
        (release / "release-manifest.json").unlink()
    if failure in {"wrong-sha", "outside-backup-dir"}:
        (release / "release-manifest.json").write_text(json.dumps(manifest))
    result = run(current, backups, inspect)
    assert result["status"] == "investigate", failure


def test_rejects_traversal_entry_even_if_archive_checksum_is_valid(tmp_path):
    current, backups, _, uploads, _, _ = setup_release(tmp_path)
    with tarfile.open(uploads, "w:gz") as tar:
        info = tarfile.TarInfo("../../danger.txt")
        data = b"not extracted"
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    uploads.chmod(0o600)
    checksum(uploads)
    result = run(current, backups)
    assert result["archives"]["uploads"]["sha256_matches"] is True
    assert result["archives"]["uploads"]["archive_index_readable"] is False
    assert result["status"] == "investigate"


def test_rejects_invalid_commit_sha_before_accessing_files(tmp_path):
    with pytest.raises(ValueError):
        audit.audit_release_recovery(
            expected_sha="wrong", current=tmp_path / "current", backup_dir=tmp_path,
        )
