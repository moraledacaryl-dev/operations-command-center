"""First-launch recovery never silently deletes or replaces training records."""
from __future__ import annotations

import os
from pathlib import Path
import sqlite3

import pytest

from scripts.training_first_launch import (
    JOURNAL_CONTENT, JOURNAL_NAME,
    prepare_first_launch, mark_initialized, tidy_completed_launch,
)


@pytest.fixture
def private_state(tmp_path: Path) -> tuple[Path, Path]:
    state = tmp_path / "OperationsTraining"
    for name in ("data", "uploads", "private/accounts"):
        (state / name).mkdir(parents=True)
    return state, state / "data" / "operations_training_demo_test.sqlite"


def test_new_install_has_private_journal_and_finishes_without_deleting_data(private_state):
    state, db = private_state
    assert prepare_first_launch(state, db) == "fresh"
    journal = state / "data" / JOURNAL_NAME
    assert journal.read_text() == JOURNAL_CONTENT
    if os.name != "nt":
        assert journal.stat().st_mode & 0o077 == 0
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE demo (item TEXT)")
        conn.execute("INSERT INTO demo VALUES ('preserve')")
    mark_initialized(state, "SYNTHETIC_TEST_ONLY\n")
    assert (state / "data" / ".initialized").read_text() == "SYNTHETIC_TEST_ONLY\n"
    assert not journal.exists()
    tidy_completed_launch(state)
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT item FROM demo").fetchone()[0] == "preserve"
    with pytest.raises(RuntimeError, match="initialized data"):
        prepare_first_launch(state, db)


def test_cancelled_migration_is_preserved_and_retried(private_state):
    state, db = private_state
    assert prepare_first_launch(state, db) == "fresh"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE alembic_version (version_num TEXT)")
        conn.execute("INSERT INTO alembic_version VALUES ('partial')")
    assert prepare_first_launch(state, db) == "recovered"
    assert not db.exists()
    backups = list((state / "recovery").glob("*/data/" + db.name))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "partial"
    # Retain the same journal for a fresh, independently seeded retry.
    assert prepare_first_launch(state, db) == "recovered"
    assert (state / "data" / JOURNAL_NAME).read_text() == JOURNAL_CONTENT


def test_cancelled_seed_with_accounts_never_discards_private_credential_files(private_state):
    state, db = private_state
    prepare_first_launch(state, db)
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE users (email TEXT)")
        conn.execute("INSERT INTO users VALUES ('reception-am@training.invalid')")
    accounts = state / "private" / "accounts"
    (accounts / "PRIVATE_training_accounts.json").write_text('{"secret":"randomized"}')
    (accounts / "training_manifest.json").write_text('{"synthetic":true}')
    (accounts / "PRIVATE_TRAINER_ACCOUNTS.txt").write_text("trainer private list")
    (state / "data" / ".initialized.pending").write_text("partial marker")
    assert prepare_first_launch(state, db) == "recovered"
    folders = list((state / "recovery").iterdir())
    assert len(folders) == 1
    archived = folders[0]
    with sqlite3.connect(archived / "data" / db.name) as conn:
        assert conn.execute("SELECT email FROM users").fetchone()[0].endswith("@training.invalid")
    assert (archived / "private/accounts/PRIVATE_training_accounts.json").read_text() == '{"secret":"randomized"}'
    assert (archived / "private/accounts/PRIVATE_TRAINER_ACCOUNTS.txt").read_text() == "trainer private list"
    assert (archived / "data/.initialized.pending").read_text() == "partial marker"
    assert not (accounts / "PRIVATE_training_accounts.json").exists()
    if os.name != "nt":
        assert archived.stat().st_mode & 0o077 == 0


def test_unknown_prior_database_is_not_reset_without_journal(private_state):
    state, db = private_state
    db.write_bytes(b"old training or other user data")
    with pytest.raises(RuntimeError, match="lack a first-launch journal"):
        prepare_first_launch(state, db)
    assert db.read_bytes() == b"old training or other user data"
    assert not (state / "recovery").exists()


@pytest.mark.parametrize("unexpected_path", ["data/other.sqlite", "uploads/guest-photo.png", "private/accounts/unknown.txt"])
def test_unrecognized_files_block_automated_recovery(private_state, unexpected_path):
    state, db = private_state
    prepare_first_launch(state, db)
    db.write_bytes(b"partial sqlite")
    extra = state / unexpected_path
    extra.parent.mkdir(parents=True, exist_ok=True)
    extra.write_bytes(b"preserve")
    with pytest.raises(RuntimeError, match="(unrecognized|uploads)"):
        prepare_first_launch(state, db)
    assert db.read_bytes() == b"partial sqlite"
    assert extra.read_bytes() == b"preserve"
    assert not (state / "recovery").exists()


def test_forged_or_damaged_journal_refuses_recovery(private_state):
    state, db = private_state
    prepare_first_launch(state, db)
    db.write_bytes(b"must not overwrite")
    (state / "data" / JOURNAL_NAME).write_text("incorrect journal")
    with pytest.raises(RuntimeError, match="no valid interrupted"):
        prepare_first_launch(state, db)
    assert db.read_bytes() == b"must not overwrite"


def test_crash_after_committed_marker_only_cleans_journal(private_state):
    state, db = private_state
    prepare_first_launch(state, db)
    db.write_bytes(b"record data remains")
    (state / "data" / ".initialized").write_text("SYNTHETIC_TEST_ONLY\n")
    tidy_completed_launch(state)
    assert not (state / "data" / JOURNAL_NAME).exists()
    assert db.read_bytes() == b"record data remains"
    assert not (state / "recovery").exists()


def test_symlinked_database_is_never_quarantined(private_state):
    state, db = private_state
    prepare_first_launch(state, db)
    foreign = state.parent / "foreign-data.sqlite"
    foreign.write_bytes(b"foreign data")
    try:
        db.symlink_to(foreign)
    except (OSError, NotImplementedError):
        pytest.skip("Symlinks unavailable on this runner")
    with pytest.raises(RuntimeError, match="symbolic link"):
        prepare_first_launch(state, db)
    assert foreign.read_bytes() == b"foreign data"
    assert not (state / "recovery").exists()
