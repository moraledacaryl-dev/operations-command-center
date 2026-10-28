"""Frozen offline Operations training runtime for macOS; no Docker and no live integrations."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys


def refuse(reason: str) -> None:
    raise SystemExit("TRAINING REFUSED: " + reason)


def bundled_backend() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[2] / "backend"


def validate() -> tuple[Path, Path]:
    if sys.platform != "darwin":
        refuse("This executable is for macOS only")
    if os.environ.get("ENVIRONMENT") != "local":
        refuse("Environment must be local")
    if os.environ.get("ALLOW_DEMO_SEED") != "false":
        refuse("Default local demo seed is disabled")
    if os.environ.get("ALLOW_DEFAULT_ADMIN_BOOTSTRAP") != "false":
        refuse("Default account bootstrap is disabled")
    expected_state = Path.home() / "Library" / "Application Support" / "HiddenOasis" / "OperationsTraining"
    raw_state = os.environ.get("TRAINING_STATE_DIR")
    if not raw_state or Path(raw_state).resolve() != expected_state.resolve():
        refuse("Training state must be in this user's private Application Support directory")
    state = expected_state.resolve()
    expected_db = state / "data" / "operations_training_demo_macdesktop.sqlite"
    db = os.environ.get("DATABASE_URL", "")
    if db != "sqlite:///" + expected_db.as_posix():
        refuse("Refusing nontraining or remote database")
    if expected_db.is_symlink() or any(p.is_symlink() for p in expected_db.parents):
        refuse("Training database path must not contain symlinks")
    if not (state / "private").is_dir() or not (state / "uploads").is_dir():
        refuse("Training private state directories missing")
    return expected_db, state


def refresh_fictional_notices(path: Path, state: Path) -> None:
    # Existing training installs keep all their saved records and private accounts.
    script = bundled_backend() / "scripts" / "seed_training_demo.py"
    spec = importlib.util.spec_from_file_location("training_mac_notice_upgrade", str(script))
    if not spec or not spec.loader:
        refuse("Packaged training data maintenance script missing")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    count = module.ensure_notification_practice_data(path, state)
    print(f"PASS: fictional per-user notification drills ready ({count} newly added)", flush=True)


def init() -> None:
    path, state = validate()
    marker = state / "data" / ".initialized"
    roster = state / "private" / "accounts" / "PRIVATE_training_accounts.json"
    if marker.exists():
        if not path.is_file() or not roster.is_file():
            refuse("Training initialization incomplete; do not reset practice data")
        refresh_fictional_notices(path, state)
        print("PASS: existing synthetic training records preserved", flush=True)
        return
    if path.exists() or roster.exists():
        refuse("An incomplete training database already exists; refusing to overwrite it")

    from alembic import command
    from alembic.config import Config

    root = bundled_backend()
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(config, "head")
    script = root / "scripts" / "seed_training_demo.py"
    spec = importlib.util.spec_from_file_location("frozen_training_mac_seed", str(script))
    if spec is None or spec.loader is None:
        refuse("Training seed script missing from application bundle")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.guard()
    module.seed(path, state / "private" / "accounts")
    if not roster.exists():
        refuse("Synthetic private credential roster was not created")
    marker.write_text("SYNTHETIC_MAC_TRAINING_ONLY\n", encoding="utf-8")
    marker.chmod(0o600)
    refresh_fictional_notices(path, state)
    print("PASS: private, fictional role-based Operations dataset", flush=True)


def serve() -> None:
    path, state = validate()
    if not path.is_file() or not (state / "data" / ".initialized").is_file():
        refuse("Training DB must be initialized before server startup")
    os.chdir(bundled_backend())
    from app.main import app
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8401, workers=1, access_log=False, log_level="warning")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "init":
        init()
    elif action == "serve":
        serve()
    else:
        refuse("Expected init or serve")
