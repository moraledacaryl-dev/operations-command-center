"""Windows offline training backend shipped as a frozen PyInstaller application.

Commands:
    training-api.exe init     -> migrate a new private, fictional-only SQLite DB
    training-api.exe serve    -> localhost API only

All configuration is injected by the Windows controller; never reads production env.
"""
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import sys


def abort(message: str) -> None:
    raise SystemExit("TRAINING REFUSED: " + message)


def resources() -> Path:
    if not getattr(sys, "frozen", False):
        return Path(__file__).resolve().parents[2] / "backend"
    return Path(sys._MEIPASS)  # type: ignore[attr-defined]


def validate() -> tuple[Path, Path]:
    if os.name != "nt":
        abort("Windows-only distribution")
    if os.environ.get("ENVIRONMENT") != "local":
        abort("Environment must be local")
    if os.environ.get("ALLOW_DEMO_SEED") != "false":
        abort("Default local demos must be disabled")
    if os.environ.get("ALLOW_DEFAULT_ADMIN_BOOTSTRAP") != "false":
        abort("Default bootstrap must be disabled")
    db = os.environ.get("DATABASE_URL", "")
    if not db.startswith("sqlite:///") or not db[10:].startswith(("C:/", "D:/", "E:/")):
        abort("Training database must use a Windows absolute SQLite path")
    path = Path(db[len("sqlite:///"):])
    if not path.is_absolute() or not path.name.startswith("operations_training_demo_") or path.suffix != ".sqlite":
        abort("Unexpected training DB path")
    state = Path(os.environ.get("TRAINING_STATE_DIR", "")).resolve()
    if not state.is_absolute() or not (state / "data") == path.parent:
        abort("Database must be inside the private desktop-training data directory")
    if not (state / "private").is_dir():
        abort("Training private account directory missing")
    return path, state


def refresh_fictional_notices(path: Path, state: Path) -> None:
    # Do not reset already-created desktop training accounts or history.
    script = resources() / "scripts" / "seed_training_demo.py"
    spec = importlib.util.spec_from_file_location("training_windows_notice_upgrade", str(script))
    if not spec or not spec.loader:
        abort("Packaged training data maintenance script missing")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    count = module.ensure_notification_practice_data(path, state)
    module.ensure_private_trainer_guide(state / "private" / "accounts")
    print(f"PASS: fictional per-user notification drills ready ({count} newly added)")


def init() -> None:
    path, state = validate()
    marker = state / "data" / ".initialized"
    roster = state / "private" / "accounts" / "PRIVATE_training_accounts.json"
    if marker.exists():
        if not path.is_file() or not roster.is_file():
            abort("Incomplete initialized training database; do not clear manually")
        refresh_fictional_notices(path, state)
        print("PASS: existing fictional training data preserved")
        return
    if path.exists() or roster.exists():
        abort("Pre-existing incomplete DB or credentials; no changes made")
    from alembic import command
    from alembic.config import Config
    root = resources()
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")
    target = root / "scripts" / "seed_training_demo.py"
    spec = importlib.util.spec_from_file_location("training_seed_frozen", str(target))
    if not spec or not spec.loader:
        abort("Packaged training seed script absent")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module.guard()
    module.seed(path, state / "private" / "accounts")
    if not roster.is_file():
        abort("Credentials were not created")
    marker.write_text("SYNTHETIC_DESKTOP_TRAINING_ONLY\n", encoding="utf-8")
    refresh_fictional_notices(path, state)
    print("PASS: independently generated, isolated fictional training data")


def serve() -> None:
    print("TRAINING API: validating local fictional database", flush=True)
    path, state = validate()
    if not (state / "data" / ".initialized").is_file() or not path.is_file():
        abort("Initialize fictional training data before serving")
    # Alembic's script_location is relative. Set the frozen code directory
    # as the working directory for readiness migration-head validation.
    os.chdir(resources())
    print("TRAINING API: loading command center modules", flush=True)
    from app.main import app
    print("TRAINING API: loading local ASGI server", flush=True)
    import uvicorn
    print("TRAINING API: listening on localhost:8401", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8401, workers=1, access_log=False, log_level="info")


if __name__ == "__main__":
    try:
        mode = sys.argv[1] if len(sys.argv) > 1 else ""
        if mode == "init":
            init()
        elif mode == "serve":
            serve()
        else:
            abort("Choose init or serve")
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise SystemExit(1) from exc
