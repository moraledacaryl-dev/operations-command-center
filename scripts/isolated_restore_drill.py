#!/usr/bin/env python3
"""Restore Operations backups into a NEW, disposable, network-isolated Docker PG.

Only the explicitly spawned container and private temporary extraction directory
are written. No live DATABASE_URL, production DB host, systemd service, or
application uploads directory is accessed as a restore destination.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath

from certify_release_backup_readonly import audit_release_recovery

CONTAINER_ID = re.compile(r"^[0-9a-f]{64}$")
IMAGE = "postgres:16-alpine"
DB_NAME = "operations_restore_drill"
DB_USER = "operations_drill"
CORE_TABLES = (
    "alembic_version", "users", "projects", "attachments",
    "integration_deliveries", "integration_event_inbox", "external_review_items",
)
# Never print subprocess stderr: backup file names, SQL content and app paths
# may be included in vendor error messages.


class DrillFailure(Exception):
    pass


def container_start_args(name: str, image: str = IMAGE) -> list[str]:
    if not re.fullmatch(r"operations-restore-[a-f0-9]{12}", name):
        raise DrillFailure("Invalid disposable container identifier")
    if image != IMAGE:
        raise DrillFailure("Only the repository's pinned PostgreSQL image is allowed")
    return [
        "docker", "run", "--detach", "--rm", "--pull=never",
        "--network=none", "--name", name,
        "--memory=2g", "--cpus=2", "--pids-limit=128",
        "--security-opt=no-new-privileges", "--log-driver=none",
        "--label", "hiddenoasis.operations.restore-drill=true",
        "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
        "--env", f"POSTGRES_DB={DB_NAME}",
        "--env", f"POSTGRES_USER={DB_USER}",
        image,
    ]


def safe_execute(args: list[str], *, stdin=None, timeout=120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            args, stdin=stdin, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DrillFailure("Disposable PostgreSQL command failed or timed out") from exc


def require_ok(result: subprocess.CompletedProcess, action: str) -> bytes:
    if result.returncode:
        raise DrillFailure(action + " failed in disposable container")
    return result.stdout


def query_integer(cid: str, sql: str) -> int:
    raw = require_ok(safe_execute([
        "docker", "exec", cid, "psql", "--no-psqlrc", "--tuples-only",
        "--no-align", "--set=ON_ERROR_STOP=1", "--username", DB_USER,
        "--dbname", DB_NAME, "--command", sql,
    ]), "Restored database verification").decode("ascii", errors="strict").strip()
    if not re.fullmatch(r"[0-9]+", raw):
        raise DrillFailure("Disposable PostgreSQL returned an invalid count")
    return int(raw)


def query_migration(cid: str) -> str:
    raw = require_ok(safe_execute([
        "docker", "exec", cid, "psql", "--no-psqlrc", "--tuples-only",
        "--no-align", "--set=ON_ERROR_STOP=1", "--username", DB_USER,
        "--dbname", DB_NAME, "--command", "SELECT version_num FROM alembic_version",
    ]), "Restored migration check").decode("ascii", errors="strict").strip()
    if "\n" in raw or not re.fullmatch(r"[a-zA-Z0-9_]+", raw):
        raise DrillFailure("Unexpected disposable Alembic revision state")
    return raw


def restore_database(db_dump: Path, expected_migration: str) -> dict:
    name = "operations-restore-" + secrets.token_hex(6)
    container = None
    cleanup_ok = False
    try:
        raw = require_ok(safe_execute(container_start_args(name)), "Disposable container startup")
        candidate = raw.decode("ascii", errors="strict").strip()
        if not CONTAINER_ID.fullmatch(candidate):
            raise DrillFailure("Docker did not return an isolated container identity")
        container = candidate
        # The Docker engine exposes no port and gives the container no network.
        for _ in range(45):
            ready = safe_execute([
                "docker", "exec", container, "pg_isready",
                "--username", DB_USER, "--dbname", DB_NAME,
            ], timeout=10)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise DrillFailure("Disposable PostgreSQL did not become ready")

        with db_dump.open("rb") as data:
            require_ok(safe_execute([
                "docker", "exec", "--interactive", container,
                "pg_restore", "--exit-on-error", "--no-owner", "--no-acl",
                "--username", DB_USER, "--dbname", DB_NAME,
            ], stdin=data, timeout=1800), "Full PostgreSQL restore")

        schema_count = query_integer(
            container,
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name IN ("
            + ",".join("'" + name + "'" for name in CORE_TABLES) + ")",
        )
        migration = query_migration(container)
        users_count = query_integer(container, "SELECT COUNT(*) FROM users")
        deliveries_count = query_integer(container, "SELECT COUNT(*) FROM integration_deliveries")
        inbox_count = query_integer(container, "SELECT COUNT(*) FROM integration_event_inbox")
        reviews_count = query_integer(container, "SELECT COUNT(*) FROM external_review_items")
        if schema_count != len(CORE_TABLES):
            raise DrillFailure("Core restored database tables are missing")
        if migration != expected_migration:
            raise DrillFailure("Restored Alembic revision differs from release manifest")
        if users_count == 0:
            raise DrillFailure("Restored production users table is unexpectedly empty")
        return {
            "full_pg_restore_succeeded": True,
            "required_tables_present": True,
            "migration_matches_release_manifest": True,
            "users_nonempty": True,
            "integration_tables_queryable": True,
            "restored_delivery_count": deliveries_count,
            "restored_inbox_count": inbox_count,
            "restored_review_count": reviews_count,
        }
    finally:
        if container is not None:
            # Only remove the exact ID returned by the freshly spawned
            # container. Do not delete containers by name or labels.
            cleaned = safe_execute(["docker", "rm", "--force", container], timeout=60)
            cleanup_ok = cleaned.returncode == 0
        if not cleanup_ok and container is not None:
            raise DrillFailure("Disposable container cleanup could not be confirmed")


def restore_uploads(archive_path: Path, *, max_bytes: int) -> dict:
    """Unpack every regular member privately and verify its extracted bytes."""
    if max_bytes < 1:
        raise DrillFailure("Uploads restore size limit must be positive")
    total, files, directories = 0, 0, 0
    paths: set[tuple[str, ...]] = set()
    with tempfile.TemporaryDirectory(prefix="operations-uploads-restore-") as tmp:
        root = Path(tmp)
        root.chmod(0o700)
        try:
            with tarfile.open(archive_path, "r:gz") as archive:
                for member in archive:
                    relative = PurePosixPath(member.name)
                    parts = tuple(part for part in relative.parts if part != ".")
                    if (
                        relative.is_absolute() or ".." in parts
                        or "\\" in member.name or len(member.name) > 1024
                        or member.issym() or member.islnk() or member.isdev()
                        or not (member.isdir() or member.isfile())
                    ):
                        raise DrillFailure("Unsafe uploads archive member type or path")
                    if not parts:
                        if not member.isdir():
                            raise DrillFailure("Non-directory root archive member")
                        continue
                    if parts in paths:
                        raise DrillFailure("Duplicate uploads archive member")
                    paths.add(parts)
                    dest = root.joinpath(*parts)
                    if not dest.resolve().is_relative_to(root):
                        raise DrillFailure("Uploads extraction escaped scratch directory")
                    if member.isdir():
                        dest.mkdir(mode=0o700, parents=True, exist_ok=True)
                        directories += 1
                        continue
                    if total + member.size > max_bytes or member.size < 0:
                        raise DrillFailure("Uploads archive exceeds bounded restore size")
                    dest.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise DrillFailure("Cannot read uploads archive content")
                    original = hashlib.sha256()
                    copied = 0
                    with extracted, dest.open("xb") as output:
                        while True:
                            chunk = extracted.read(1024 * 1024)
                            if not chunk:
                                break
                            copied += len(chunk)
                            if copied > member.size:
                                raise DrillFailure("Uploads archive member exceeds declared size")
                            original.update(chunk)
                            output.write(chunk)
                    dest.chmod(0o600)
                    if copied != member.size:
                        raise DrillFailure("Restored upload size mismatch")
                    reread = hashlib.sha256()
                    with dest.open("rb") as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            reread.update(chunk)
                    if reread.digest() != original.digest():
                        raise DrillFailure("Restored upload content mismatch")
                    files += 1
                    total += copied
        except (OSError, EOFError, tarfile.TarError) as exc:
            raise DrillFailure("Uploads archive could not be restored privately") from exc
    return {
        "all_upload_members_restored_and_verified": True,
        "files_restored": files,
        "directories_restored": directories,
        "upload_bytes_restored": total,
        "attachment_sample_present": files > 0,
    }


def run_drill(expected_sha: str, current: Path, backup_dir: Path, *, max_upload_bytes: int) -> dict:
    release_gate = audit_release_recovery(
        expected_sha=expected_sha, current=current, backup_dir=backup_dir,
    )
    if release_gate["status"] != "pass":
        raise DrillFailure("Release and private backup integrity preflight did not pass")
    manifest = json.loads((current.resolve() / "release-manifest.json").read_text())
    db_archive = Path(manifest["database_backup"])
    uploads_archive = Path(manifest["uploads_backup"])
    migration = manifest["migration_head"]
    if not re.fullmatch(r"[a-zA-Z0-9_]+", migration):
        raise DrillFailure("Invalid recorded migration revision")
    db_result = restore_database(db_archive, migration)
    uploads_result = restore_uploads(uploads_archive, max_bytes=max_upload_bytes)
    return {
        "status": "pass",
        "expected_sha": expected_sha,
        "source_backups_verified_read_only": True,
        "database": db_result,
        "uploads": uploads_result,
        "production_database_connection_used": False,
        "production_uploads_directory_modified": False,
        "isolated_network_disabled": True,
        "restore_drill_performed": True,
        "historical_review_integrity_certified": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="DISPOSABLE Docker PostgreSQL + uploads restore rehearsal")
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--current", type=Path, default=Path("/opt/operations-command-center/current"))
    parser.add_argument("--backup-dir", type=Path, default=Path("/root/backups/operations-command-center"))
    parser.add_argument("--max-upload-bytes", type=int, default=2 * 1024 ** 3)
    parser.add_argument("--acknowledge-disposable-drill", action="store_true")
    args = parser.parse_args()
    if not args.acknowledge_disposable_drill:
        parser.error("Explicit --acknowledge-disposable-drill required; use an isolated staging host")
    try:
        report = run_drill(
            args.expected_sha, args.current, args.backup_dir,
            max_upload_bytes=args.max_upload_bytes,
        )
    except (DrillFailure, ValueError, OSError, KeyError, TypeError) as exc:
        report = {
            "status": "investigate",
            "expected_sha": args.expected_sha,
            "failure_category": "verification_failed",
            "failure_type": type(exc).__name__,
            "restore_drill_passed": False,
            "production_database_connection_used": False,
        }
    print(json.dumps(report, sort_keys=True, indent=2))
    return 0 if report["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
