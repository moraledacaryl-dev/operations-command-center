#!/usr/bin/env python3
"""Read-only release/backup evidence audit. Never restores or edits production.

Run as a privileged operator on the active Operations host after the deployment
gate. Only sanitized booleans/sizes are emitted; no secrets or backup paths.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import tarfile
from pathlib import Path, PurePosixPath
from typing import Callable

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _private_regular_file(path: Path, backup_dir: Path) -> bool:
    """Reject symbolic links, non-private modes and paths outside backup_dir."""
    try:
        info = path.lstat()
        return (
            stat.S_ISREG(info.st_mode)
            and not (info.st_mode & 0o077)
            and info.st_size > 0
            and path.parent.resolve(strict=True) == backup_dir.resolve(strict=True)
            and path.resolve(strict=True) == path
        )
    except (OSError, RuntimeError):
        return False


def _checksummed_archive(path: Path, backup_dir: Path) -> dict[str, bool | int]:
    private = _private_regular_file(path, backup_dir)
    checksum_path = Path(str(path) + ".sha256")
    checksum_private = _private_regular_file(checksum_path, backup_dir)
    digest_matches = False
    if private and checksum_private:
        try:
            # Deployment uses: sha256sum "$FILE" > "$FILE.sha256"
            row = checksum_path.read_text(encoding="ascii").strip()
            matched = re.fullmatch(r"([0-9a-f]{64})[ \t]+(?:\*)?(.+)", row)
            if matched and matched.group(2) == str(path):
                digest_matches = _sha256_file(path) == matched.group(1)
        except (OSError, ValueError, UnicodeError):
            pass
    return {
        "private_regular_file": private,
        "private_checksum_file": checksum_private,
        "sha256_matches": digest_matches,
        "nonempty": bool(private),
    }


def _inspect_pg_restore(path: Path) -> bool:
    """Read only the archive table of contents, not the production database."""
    try:
        clean_env = os.environ.copy()
        clean_env.pop("PGPASSWORD", None)
        clean_env.pop("DATABASE_URL", None)
        result = subprocess.run(
            ["pg_restore", "--list", str(path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=clean_env,
            check=False,
            timeout=120,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _inspect_upload_archive(path: Path) -> bool:
    """Read headers only. Never extract a member or follow archived links."""
    try:
        count = 0
        with tarfile.open(path, "r:gz") as archive:
            for member in archive:
                name = PurePosixPath(member.name)
                if name.is_absolute() or ".." in name.parts:
                    return False
                if member.issym() or member.islnk() or member.isdev():
                    return False
                count += 1
        return count > 0
    except (OSError, EOFError, tarfile.TarError):
        return False


def audit_release_recovery(
    *, expected_sha: str, current: Path, backup_dir: Path,
    inspect_postgres: Callable[[Path], bool] = _inspect_pg_restore,
) -> dict:
    if not SHA_RE.fullmatch(expected_sha):
        raise ValueError("Expected SHA must be exactly 40 lowercase hex characters")
    report: dict = {
        "read_only": True,
        "expected_sha": expected_sha,
        "checks": {},
        "archives": {},
        "restore_drill_performed": False,
        "migration_downgrade_performed": False,
        "status": "investigate",
    }
    checks = report["checks"]
    releases_root = current.parent / "releases"
    try:
        release = current.resolve(strict=True)
        checks["active_release_matches_expected"] = (
            current.is_symlink()
            and release == releases_root / expected_sha
            and release.is_dir()
        )
    except (OSError, RuntimeError):
        checks["active_release_matches_expected"] = False
        release = releases_root / expected_sha

    manifest = {}
    if checks["active_release_matches_expected"]:
        try:
            manifest_path = release / "release-manifest.json"
            if manifest_path.stat().st_size > 16_384:
                raise ValueError("Oversized release manifest")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifest, dict):
                manifest = {}
        except (OSError, UnicodeError, ValueError):
            manifest = {}
    checks["manifest_sha_matches_expected"] = manifest.get("release_sha") == expected_sha
    checks["migration_head_recorded"] = bool(
        isinstance(manifest.get("migration_head"), str)
        and manifest["migration_head"].strip()
    )
    package_path = release / "frontend" / "package-lock.json"
    requirements_path = release / "backend" / "requirements.txt"
    for key, path in (
        ("package_lock_sha256", package_path),
        ("requirements_sha256", requirements_path),
    ):
        expected_digest = manifest.get(key)
        try:
            checks[key + "_matches"] = (
                isinstance(expected_digest, str)
                and bool(HASH_RE.fullmatch(expected_digest))
                and path.is_file()
                and not path.is_symlink()
                and _sha256_file(path) == expected_digest
            )
        except (OSError, ValueError):
            checks[key + "_matches"] = False

    for kind, manifest_key, suffix in (
        ("database", "database_backup", ".dump"),
        ("uploads", "uploads_backup", ".tar.gz"),
    ):
        raw = manifest.get(manifest_key)
        # An expected-SHA basename and confined parent are mandatory. Never
        # allow a compromised manifest to select arbitrary files.
        expected_prefix = kind + "-" if kind == "database" else "uploads-"
        valid_name = (
            isinstance(raw, str)
            and Path(raw).is_absolute()
            and Path(raw).name.startswith(expected_prefix + expected_sha + "-")
            and Path(raw).name.endswith(suffix)
        )
        path = Path(raw) if valid_name else backup_dir / "__invalid__"
        archive_checks = _checksummed_archive(path, backup_dir) if valid_name else {
            "private_regular_file": False,
            "private_checksum_file": False,
            "sha256_matches": False,
            "nonempty": False,
        }
        integrity = bool(
            archive_checks["private_regular_file"]
            and archive_checks["private_checksum_file"]
            and archive_checks["sha256_matches"]
        )
        archive_checks["archive_index_readable"] = bool(
            (inspect_postgres(path) if kind == "database" else _inspect_upload_archive(path))
            if integrity else False
        )
        report["archives"][kind] = archive_checks

    report["status"] = (
        "pass" if all(checks.values())
        and all(all(values.values()) for values in report["archives"].values())
        else "investigate"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only release/backup evidence audit")
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument(
        "--current", type=Path,
        default=Path("/opt/operations-command-center/current"),
    )
    parser.add_argument(
        "--backup-dir", type=Path,
        default=Path("/root/backups/operations-command-center"),
    )
    args = parser.parse_args()
    try:
        report = audit_release_recovery(
            expected_sha=args.expected_sha, current=args.current,
            backup_dir=args.backup_dir,
        )
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(report, sort_keys=True, indent=2))
    return 0 if report["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
