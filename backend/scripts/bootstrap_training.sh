#!/bin/sh
# One-time training initialization. This runs inside the dedicated training container only.
set -eu
umask 077

DB=/training/data/operations_training_demo_class1.sqlite
ROSTER=/training/private/accounts
MARK=/training/data/.training-seeded
export ENVIRONMENT=local
export ALLOW_DEMO_SEED=false
export ALLOW_DEFAULT_ADMIN_BOOTSTRAP=false
export DATABASE_URL=sqlite:////training/data/operations_training_demo_class1.sqlite

mkdir -p /training/data /training/uploads /training/private

if [ -e "$MARK" ]; then
    if [ ! -s "$DB" ] || [ ! -s "$ROSTER/PRIVATE_training_accounts.json" ]; then
        echo "REFUSED: incomplete training initialization; do not bypass. Review dedicated volumes." >&2
        exit 1
    fi
    # Existing training databases are retained across releases. Upgrade their
    # schema without erasing exercises, after taking an SQLite-consistent backup.
    # Never run the training seeder a second time.
    if python - <<'PY'
import os, sqlite3
from pathlib import Path
from alembic.config import Config
from alembic.script import ScriptDirectory

path = Path("/training/data/operations_training_demo_class1.sqlite")
if path.is_symlink() or not path.is_file():
    raise SystemExit("REFUSED: invalid existing training database")
with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
    revision = db.execute("SELECT version_num FROM alembic_version").fetchone()[0]
heads = ScriptDirectory.from_config(Config("alembic.ini")).get_heads()
if len(heads) != 1:
    raise SystemExit("REFUSED: ambiguous training migration heads")
if revision == heads[0]:
    raise SystemExit(0)
backup_dir = Path("/training/private")
backup = backup_dir / f"before-schema-upgrade-{revision}.sqlite"
if not backup.exists():
    if backup.is_symlink():
        raise SystemExit("REFUSED: unsafe training backup path")
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        with sqlite3.connect(backup) as dest:
            db.backup(dest)
    os.chmod(backup, 0o600)
print(f"Training schema needs upgrade: {revision} -> {heads[0]}")
raise SystemExit(2)
PY
    then
        echo "Previously seeded training data found; schema already current."
    else
        RESULT=$?
        if [ "$RESULT" -ne 2 ]; then
            echo "REFUSED: could not safely inspect the training schema." >&2
            exit "$RESULT"
        fi
        alembic upgrade head
        echo "PASS: preserved training exercises and upgraded isolated training schema."
    fi
else
    if [ -e "$DB" ]; then
        echo "REFUSED: database exists without complete marker. Manual inspection is required." >&2
        exit 1
    fi
    alembic upgrade head
    python scripts/seed_training_demo.py \
        --confirm ISOLATED_TRAINING_DATABASE_ONLY \
        --private-output "$ROSTER"
    touch "$MARK"
    echo "Created isolated synthetic Operations training database."
fi

chown -R operations:operations /training/data /training/uploads
chmod 700 /training/data /training/uploads /training/private
echo "Training initialization finished. Credentials remain in a separate private volume."
