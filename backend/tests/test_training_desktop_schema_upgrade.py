"""An installed desktop app must upgrade its real older SQLite schema."""
import os
from pathlib import Path
import subprocess
import sys
import sqlite3
import json

import pytest


@pytest.mark.parametrize("platform", ["mac", "windows"])
def test_existing_install_upgrades_without_resetting_practice(tmp_path, platform):
    root = Path(__file__).resolve().parents[2]
    state = tmp_path / "OperationsTraining"
    db = state / "data/operations_training_demo_upgrade.sqlite"
    env = os.environ | {
        "ENVIRONMENT": "local", "ALLOW_DEMO_SEED": "false",
        "ALLOW_DEFAULT_ADMIN_BOOTSTRAP": "false", "DATABASE_URL": "sqlite:///" + db.as_posix(),
        "PYTHONPATH": str(root / "backend"),
    }
    script = r'''
import hashlib, importlib.util, json, sqlite3, sys
from pathlib import Path
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
root, state, platform = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
for folder in ("data", "private/accounts", "uploads"):
    (state / folder).mkdir(parents=True)
db = state / "data/operations_training_demo_upgrade.sqlite"
cfg = Config(str(root / "backend/alembic.ini"))
cfg.set_main_option("script_location", str(root / "backend/alembic"))
command.upgrade(cfg, "0011_project_collaboration")
with sqlite3.connect(db) as conn:
    conn.execute("CREATE TABLE saved_practice (note TEXT)")
    conn.execute("INSERT INTO saved_practice VALUES ('Keep my completed exercise')")
marker = state / "data/.initialized"
marker.write_text("SYNTHETIC_TEST_ONLY\n")
roster = state / "private/accounts/PRIVATE_training_accounts.json"
roster.write_text(json.dumps({"synthetic": True, "accounts": [{"email": "staff@training.invalid", "password": "test-only-preserve"}]}))
before = roster.read_bytes()
launcher = root / ("deployment/training-desktop-" + platform + "/training_api.py")
spec = importlib.util.spec_from_file_location("desktop_upgrade_under_test", launcher)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.validate = lambda: (db, state)
if platform == "mac": module.bundled_backend = lambda: root / "backend"
else: module.resources = lambda: root / "backend"
module.refresh_fictional_notices = lambda *args: None
module.init()
head = ScriptDirectory.from_config(cfg).get_current_head()
with sqlite3.connect(db) as conn:
    assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == head
    assert conn.execute("SELECT note FROM saved_practice").fetchone()[0] == 'Keep my completed exercise'
    assert conn.execute("SELECT name FROM sqlite_master WHERE name='room_stays'").fetchone()
assert roster.read_bytes() == before
assert marker.read_text() == "SYNTHETIC_TEST_ONLY\n"
backups = list((state / "backups").glob("*.sqlite"))
assert len(backups) == 1
with sqlite3.connect(backups[0]) as conn:
    assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0011_project_collaboration"
    assert conn.execute("SELECT note FROM saved_practice").fetchone()[0] == 'Keep my completed exercise'
module.init()
assert len(list((state / "backups").glob("*.sqlite"))) == 1
assert roster.read_bytes() == before
'''
    result = subprocess.run([sys.executable, "-c", script, str(root), str(state), platform],
                            env=env, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("setting,value", [
    ("ENVIRONMENT", "production"), ("ALLOW_DEMO_SEED", "true"),
    ("ALLOW_DEFAULT_ADMIN_BOOTSTRAP", "true"), ("DATABASE_URL", "sqlite:////tmp/unrelated.sqlite"),
])
def test_upgrade_refuses_nontraining_settings_before_writing(tmp_path, monkeypatch, setting, value):
    from scripts.training_first_launch import upgrade_initialized_database
    state = tmp_path / "OperationsTraining"
    for directory in ("data", "private/accounts", "uploads"):
        (state / directory).mkdir(parents=True)
    db = state / "data/operations_training_demo_guard.sqlite"
    with sqlite3.connect(db) as connection:
        connection.execute("CREATE TABLE untouched (note TEXT)")
        connection.execute("INSERT INTO untouched VALUES ('keep')")
    (state / "data/.initialized").write_text("SYNTHETIC_TEST_ONLY\n")
    (state / "private/accounts/PRIVATE_training_accounts.json").write_text(json.dumps({"synthetic": True}))
    before = db.read_bytes()
    for name, expected in {"ENVIRONMENT": "local", "ALLOW_DEMO_SEED": "false",
                           "ALLOW_DEFAULT_ADMIN_BOOTSTRAP": "false", "DATABASE_URL": "sqlite:///" + db.as_posix()}.items():
        monkeypatch.setenv(name, expected)
    monkeypatch.setenv(setting, value)
    with pytest.raises(RuntimeError, match="private local training database"):
        upgrade_initialized_database(state, db, Path(__file__).resolve().parents[1])
    assert db.read_bytes() == before
    assert not (state / "backups").exists()
