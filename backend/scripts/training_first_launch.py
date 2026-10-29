"""Crash-safe retry for a *new* local desktop-training installation.

Only an initialization journal created before the first migration authorizes
automatic recovery. Existing completed or unrecognized data is never reset.
Failed first-launch artifacts are quarantined (not deleted) with 0700 privacy.
"""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import secrets

JOURNAL_NAME = ".first_launch_pending"
JOURNAL_CONTENT = "HIDDEN_OASIS_FICTIONAL_TRAINING_FIRST_LAUNCH_V1\n"
ACCOUNT_FILES = {
    "PRIVATE_training_accounts.json", "training_manifest.json",
    "PRIVATE_TRAINER_ACCOUNTS.txt",
}


def _refuse(message: str) -> None:
    raise RuntimeError("Training recovery refused: " + message)


def _check_private_path(path: Path) -> None:
    if path.is_symlink():
        _refuse("a training state path is a symbolic link")


def _layout(state: Path, database: Path) -> tuple[Path, Path, Path]:
    _check_private_path(state)
    data = state / "data"
    accounts = state / "private" / "accounts"
    uploads = state / "uploads"
    for directory in (data, state / "private", accounts, uploads, state / "recovery"):
        _check_private_path(directory)
    if database.parent != data or not database.name.startswith("operations_training_demo_") or database.suffix != ".sqlite":
        _refuse("database is not the expected private fictional training SQLite file")
    for directory in (data, accounts, uploads):
        if directory.exists() and not directory.is_dir():
            _refuse("a private training directory is not a directory")
    return data, accounts, uploads


def _journal(data: Path) -> Path:
    return data / JOURNAL_NAME


def _assert_journal(data: Path) -> None:
    journal = _journal(data)
    _check_private_path(journal)
    if not journal.is_file() or journal.read_text(encoding="utf-8") != JOURNAL_CONTENT:
        _refuse("no valid interrupted-first-launch journal exists")


def _artifacts(state: Path, database: Path) -> list[Path]:
    data, accounts, uploads = _layout(state, database)
    db_files = {database.name, database.name + "-wal", database.name + "-shm", database.name + "-journal"}
    allowed_data = db_files | {JOURNAL_NAME, ".initialized.pending"}
    if data.exists() and any(p.name not in allowed_data for p in data.iterdir()):
        _refuse("unrecognized files in private training data; manual review required")
    if accounts.exists() and any(p.name not in ACCOUNT_FILES for p in accounts.iterdir()):
        _refuse("unrecognized private credentials; manual review required")
    if uploads.exists() and any(uploads.iterdir()):
        _refuse("existing uploads must not be reset automatically")
    paths = [data / name for name in sorted(db_files | {".initialized.pending"})]
    paths.extend(accounts / name for name in sorted(ACCOUNT_FILES))
    for path in paths:
        _check_private_path(path)
        if path.exists() and not path.is_file():
            _refuse("unexpected training artifact type; manual review required")
    return [path for path in paths if path.exists()]


def prepare_first_launch(state: Path, database: Path) -> str:
    """Return 'fresh' or 'recovered'; never modify an initialized installation.

    A journal proves the installer started a new installation. Incomplete
    accounts/SQLite are retained in a timestamped private recovery directory
    before fresh migrations; they are never silently deleted.
    """
    data, accounts, _ = _layout(state, database)
    if (data / ".initialized").exists():
        _refuse("initialized data may not be reset")
    data.mkdir(parents=True, exist_ok=True)
    journal = _journal(data)
    _check_private_path(journal)
    if journal.exists():
        _assert_journal(data)
        paths = _artifacts(state, database)
        if paths:
            root = state / "recovery"
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
            _check_private_path(root)
            folder = root / ("interrupted-first-launch-" +
                             datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") +
                             "-" + secrets.token_hex(6))
            folder.mkdir(mode=0o700)
            for source in paths:
                relative = source.relative_to(state)
                target = folder / relative
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                os.replace(source, target)
            print("Incomplete fictional training setup preserved privately under " + str(folder), flush=True)
        return "recovered"

    if database.exists() or accounts.exists() and any(accounts.iterdir()):
        _refuse("existing files lack a first-launch journal; refusing to overwrite")
    # Fail closed for leftover WAL/SHM/journal or unknown files even without DB.
    if _artifacts(state, database):
        _refuse("untracked SQLite sidecars or private accounts; manual review required")
    descriptor = os.open(journal, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(JOURNAL_CONTENT)
        stream.flush()
        os.fsync(stream.fileno())
    return "fresh"


def complete_first_launch(state: Path) -> None:
    """Only remove the journal *after* the installed marker is durable."""
    data = state / "data"
    _assert_journal(data)
    marker = data / ".initialized"
    _check_private_path(marker)
    if not marker.is_file():
        _refuse("cannot complete first launch without initialized marker")
    _journal(data).unlink()


def mark_initialized(state: Path, contents: str) -> None:
    """Atomically publish the marker after seeding, then close the journal."""
    data = state / "data"
    _assert_journal(data)
    marker = data / ".initialized"
    staged = data / ".initialized.pending"
    for path in (marker, staged):
        _check_private_path(path)
        if path.exists():
            _refuse("unexpected existing initialization marker")
    descriptor = os.open(staged, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(contents)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(staged, marker)
    complete_first_launch(state)


def tidy_completed_launch(state: Path) -> None:
    """A crash after writing .initialized but before unlinking the journal."""
    data = state / "data"
    marker = data / ".initialized"
    _check_private_path(marker)
    if not marker.is_file():
        _refuse("completed training marker missing")
    if _journal(data).exists():
        _assert_journal(data)
        _journal(data).unlink()
