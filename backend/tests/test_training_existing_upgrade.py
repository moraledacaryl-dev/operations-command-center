"""Existing desktop training upgrades keep private accounts and practice work."""
from pathlib import Path
import json
import os
import sqlite3
from unittest.mock import patch
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app import models, foundation_models
from app.database import Base
from scripts.seed_training_demo import PEOPLE, ensure_notification_practice_data
from scripts.training_first_launch import upgrade_existing_training_database
ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture
def old_training(tmp_path, monkeypatch):
    state = tmp_path / 'training'; (state / 'data').mkdir(parents=True); (state / 'private' / 'accounts').mkdir(parents=True); (state / 'uploads').mkdir()
    db_path = state / 'data' / 'operations_training_demo_test.sqlite'
    engine = create_engine('sqlite:///' + db_path.as_posix()); Base.metadata.create_all(engine)
    legacy = {slug + '@training.invalid' for _, _, slug, _ in PEOPLE} - {'bar-lead@training.invalid', 'bartender@training.invalid'}
    Session = sessionmaker(bind=engine)
    with Session() as db:
        for email in sorted(legacy): db.add(models.User(name='Demo', email=email, role='staff', is_active=True, password_hash='unchanged-test-hash'))
        db.commit()
    with sqlite3.connect(db_path) as con:
        con.execute('CREATE TABLE alembic_version (version_num VARCHAR(32))')
        con.execute("INSERT INTO alembic_version VALUES ('0014_room_stays')")
        con.execute('CREATE TABLE saved_practice (note TEXT)')
        con.execute("INSERT INTO saved_practice VALUES ('keep this')")
    (state / 'data' / '.initialized').write_text('SYNTHETIC')
    roster = state / 'private' / 'accounts' / 'PRIVATE_training_accounts.json'
    roster.write_text(json.dumps({'synthetic': True, 'accounts': [{'email': email} for email in sorted(legacy)]}))
    monkeypatch.setenv('ENVIRONMENT','local'); monkeypatch.setenv('ALLOW_DEMO_SEED','false'); monkeypatch.setenv('ALLOW_DEFAULT_ADMIN_BOOTSTRAP','false'); monkeypatch.setenv('DATABASE_URL','sqlite:///' + db_path.as_posix())
    monkeypatch.setattr('app.database.SessionLocal', Session)
    yield state, db_path, roster
    engine.dispose()


def test_legacy_accounts_are_accepted_without_adding_users(old_training):
    state, db, roster = old_training; original = roster.read_bytes()
    assert ensure_notification_practice_data(db, state, validate_only=True) == 0
    with sqlite3.connect(db) as con: assert con.execute('SELECT count(*) FROM users').fetchone()[0] == len(PEOPLE)-2
    assert roster.read_bytes() == original
    data=json.loads(original); data['accounts'].pop(); roster.write_text(json.dumps(data))
    with pytest.raises(SystemExit, match='manifest did not match'):
        ensure_notification_practice_data(db, state, validate_only=True)


def test_upgrade_takes_private_backup_and_keeps_records(old_training):
    state, db, roster = old_training; before = roster.read_bytes()
    def fake_upgrade(config, target):
        backups=list((state/'private/backups').glob('*.sqlite')); assert len(backups)==1
        with sqlite3.connect(backups[0]) as con:
            assert con.execute('SELECT note FROM saved_practice').fetchone()[0]=='keep this'
            assert con.execute('SELECT version_num FROM alembic_version').fetchone()[0]=='0014_room_stays'
        with sqlite3.connect(db) as con: con.execute("UPDATE alembic_version SET version_num='0017_password_change_required'")
    with patch('alembic.command.upgrade', side_effect=fake_upgrade):
        assert upgrade_existing_training_database(state, db, ROOT)
        assert not upgrade_existing_training_database(state, db, ROOT)
    assert roster.read_bytes()==before
    with sqlite3.connect(db) as con: assert con.execute('SELECT note FROM saved_practice').fetchone()[0]=='keep this'
    backup=next((state/'private/backups').glob('*.sqlite'))
    if os.name != 'nt': assert backup.stat().st_mode & 0o077 == 0


def test_upgrade_rejects_nonlocal_database(old_training, monkeypatch):
    state, db, _ = old_training; monkeypatch.setenv('ENVIRONMENT','production')
    with pytest.raises(RuntimeError, match='isolated local training'):
        upgrade_existing_training_database(state, db, ROOT)
    assert not (state/'private/backups').exists()


def test_failed_migration_leaves_recoverable_backup(old_training):
    state, db, roster = old_training; original = roster.read_bytes()
    with patch('alembic.command.upgrade', side_effect=RuntimeError('migration failed')):
        with pytest.raises(RuntimeError, match='migration failed'):
            upgrade_existing_training_database(state, db, ROOT)
    backup=next((state/'private/backups').glob('*.sqlite'))
    with sqlite3.connect(backup) as con:
        assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert con.execute('SELECT note FROM saved_practice').fetchone()[0]=='keep this'
    assert roster.read_bytes()==original
