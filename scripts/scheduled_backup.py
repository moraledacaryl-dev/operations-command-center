#!/usr/bin/env python3
"""Verified private snapshots. Never prunes archives or changes business data."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import tempfile

from certify_release_backup_readonly import audit_release_recovery


class BackupFailure(Exception):
    pass


class BackupBusy(BackupFailure):
    pass


@contextmanager
def deployment_lock(path: Path):
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():
            raise BackupFailure("Untrusted deployment lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise BackupBusy("Deployment or backup is active") from exc
        yield
    finally:
        os.close(fd)


def execute(args: list[str]):
    result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1800)
    if result.returncode:
        raise BackupFailure("Backup command failed")


def current_database_revision(release: Path) -> str:
    env = os.environ.copy()
    env['PYTHONPATH'] = '.'
    result = subprocess.run([str(release/'backend/.venv/bin/python'), str(release/'backend/scripts/database_revision.py')],
                            cwd=release/'backend', env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30)
    value = result.stdout.decode('ascii', errors='strict').strip()
    if result.returncode or not re.fullmatch('[a-zA-Z0-9_]+', value):
        raise BackupFailure('Current database revision could not be verified')
    return value


def write_status(path: Path, attempt: str, *, success_sha: str | None = None):
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    if path.parent.is_symlink() or path.parent.stat().st_uid != os.geteuid() or path.parent.stat().st_mode & 0o022:
        raise BackupFailure("Untrusted status directory")
    previous = {}
    try:
        if path.is_file() and not path.is_symlink() and path.stat().st_size < 4096:
            previous = json.loads(path.read_text())
    except (OSError, ValueError):
        pass
    stamp = datetime.now(timezone.utc).isoformat()
    # Whitelist only aggregate state. Never publish backup paths or credentials.
    report = {"last_attempt_at": stamp, "last_attempt_status": attempt}
    for key in ("last_success_at", "last_success_release"):
        if isinstance(previous.get(key), str):
            report[key] = previous[key]
    if success_sha:
        report.update(last_success_at=stamp, last_success_release=success_sha)
    fd, raw = tempfile.mkstemp(prefix=".status-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(report, stream)
            stream.flush()
            os.fsync(stream.fileno())
        Path(raw).chmod(0o644)
        os.replace(raw, path)
    finally:
        Path(raw).unlink(missing_ok=True)


def create_snapshot(current: Path, base: Path, uploads: Path, *, minimum_free_mb=2048, runner=execute) -> Path:
    release = current.resolve(strict=True)
    sha = release.name
    if not current.is_symlink() or release != current.parent / "releases" / sha or not re.fullmatch("[a-f0-9]{40}", sha):
        raise BackupFailure("Active immutable release is invalid")
    source = json.loads((release / "release-manifest.json").read_text())
    if source.get("release_sha") != sha or not re.fullmatch("[a-zA-Z0-9_]+", source.get("migration_head", "")):
        raise BackupFailure("Active release manifest is invalid")
    if not uploads.is_absolute() or not uploads.is_dir() or uploads.is_symlink():
        raise BackupFailure("Uploads must be an existing absolute directory")
    if base.is_symlink() or minimum_free_mb < 1:
        raise BackupFailure("Invalid backup destination or capacity floor")
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    if base.resolve() != base or base.stat().st_uid != os.geteuid() or base.stat().st_mode & 0o077:
        raise BackupFailure("Backup directory must be private and operator-owned")
    if uploads == base or base.is_relative_to(uploads) or uploads.is_relative_to(base):
        raise BackupFailure("Uploads and backups must be separate")
    if shutil.disk_usage(base).free < minimum_free_mb * 1024**2:
        raise BackupFailure("Backup disk capacity floor not met")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    final = base / ("snapshot-" + stamp + "-" + secrets.token_hex(4))
    if final.exists() or final.is_symlink():
        raise BackupFailure("Snapshot destination already exists")
    with tempfile.TemporaryDirectory(prefix=".incomplete-", dir=base) as raw:
        working = Path(raw)
        backup_dir = working / "backups"
        backup_dir.mkdir(mode=0o700)
        descriptor = working / "app/releases" / sha
        descriptor.mkdir(parents=True, mode=0o700)
        (working / "app/current").symlink_to(descriptor, target_is_directory=True)
        for relative, key in (("frontend/package-lock.json", "package_lock_sha256"), ("backend/requirements.txt", "requirements_sha256")):
            original = release / relative
            digest = hashlib.sha256(original.read_bytes()).hexdigest()
            if digest != source.get(key):
                raise BackupFailure("Active code fingerprint mismatch")
            target = descriptor / relative
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            target.chmod(0o600)
        db_name, uploads_name = f"database-{sha}-{stamp}.dump", f"uploads-{sha}-{stamp}.tar.gz"
        revision = current_database_revision(release)
        if revision != source['migration_head']:
            raise BackupFailure('Database schema differs from active application')
        runner([str(release / "backend/.venv/bin/python"), str(release / "backend/scripts/backup_postgres.py"), str(backup_dir / db_name)])
        runner(["bash", str(release / "scripts/backup_uploads.sh"), str(uploads), str(backup_dir / uploads_name)])
        manifest = {key: source[key] for key in ("release_sha", "migration_head", "package_lock_sha256", "requirements_sha256")}
        # A scheduled snapshot is taken after activation, under the same lock;
        # unlike the deployment's pre-migration archive it uses the current head.
        manifest["database_backup_migration_head"] = revision
        manifest.update(built_at=datetime.now(timezone.utc).isoformat(), recovery_descriptor_only=True)
        for kind, name in (("database", db_name), ("uploads", uploads_name)):
            archive = backup_dir / name
            if not archive.is_file() or archive.is_symlink() or archive.stat().st_size == 0:
                raise BackupFailure("Backup archive was not created")
            archive.chmod(0o600)
            with archive.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            checksum = Path(str(archive) + ".sha256")
            checksum.write_text(digest + "  " + str(archive) + "\n")
            checksum.chmod(0o600)
            manifest[kind + "_backup"] = str(archive)
        manifest_path = descriptor / "release-manifest.json"
        manifest_path.write_text(json.dumps(manifest))
        audit = audit_release_recovery(expected_sha=sha, current=working / "app/current", backup_dir=backup_dir)
        if audit["status"] != "pass":
            raise BackupFailure("New backup verification failed")
        # Rewrite only this new recovery descriptor to the final private paths.
        for kind, name in (("database", db_name), ("uploads", uploads_name)):
            path = backup_dir / name
            checksum = Path(str(path) + ".sha256")
            digest = checksum.read_text().split()[0]
            manifest[kind + "_backup"] = str(final / "backups" / name)
            checksum.write_text(digest + "  " + manifest[kind + "_backup"] + "\n")
            checksum.chmod(0o600)
        manifest_path.write_text(json.dumps(manifest)); manifest_path.chmod(0o600)
        (working / "app/current").unlink()
        (working / "app/current").symlink_to(final / "app/releases" / sha, target_is_directory=True)
        for path in working.rglob("*"):
            if path.is_file() and not path.is_symlink():
                with path.open("rb") as stream:
                    os.fsync(stream.fileno())
        os.rename(working, final)
    # Verify the published layout too; retain evidence on failure, never prune it.
    audit = audit_release_recovery(expected_sha=sha, current=final / "app/current", backup_dir=final / "backups")
    if audit["status"] != "pass":
        raise BackupFailure("Published backup verification failed")
    pointer = base / (".latest-" + secrets.token_hex(4))
    try:
        pointer.symlink_to(final, target_is_directory=True)
        os.replace(pointer, base / "latest")
        directory_fd = os.open(base, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        pointer.unlink(missing_ok=True)
    return final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current", type=Path, default=Path("/opt/operations-command-center/current"))
    parser.add_argument("--backup-dir", type=Path, default=Path("/root/backups/operations-command-center/scheduled"))
    parser.add_argument("--status", type=Path, default=Path("/var/lib/operations-command-center-backup/status.json"))
    parser.add_argument("--lock", type=Path, default=Path("/run/operations-command-center.deploy.lock"))
    args = parser.parse_args()
    os.umask(0o077)
    if os.geteuid() != 0:
        parser.error("Run as the authorized backup operator")
    try:
        with deployment_lock(args.lock):
            result = create_snapshot(args.current, args.backup_dir, Path(os.environ.get("UPLOAD_DIR", "")))
            sha = json.loads((result / "app/current/release-manifest.json").read_text())["release_sha"]
            write_status(args.status, "ok", success_sha=sha)
        print('{"status":"pass","archives_verified":true,"archives_deleted":false}')
        return 0
    except BackupBusy:
        write_status(args.status, "busy")
        print('{"status":"busy","retry":"next_timer","archives_deleted":false}')
        return 0
    except Exception:
        write_status(args.status, "failed")
        print('{"status":"failed","detail":"Inspect backup service and capacity; private diagnostics are suppressed","archives_deleted":false}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
