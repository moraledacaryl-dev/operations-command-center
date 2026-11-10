"""A populated legacy database can upgrade without publishing historical SOPs."""
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

BACKEND = Path(__file__).resolve().parents[1]


def migrate(rev, path):
    env = dict(os.environ, ENVIRONMENT="test", DATABASE_URL="sqlite:///" + str(path),
               ALLOW_DEFAULT_ADMIN_BOOTSTRAP="false")
    result = subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", rev],
                            cwd=BACKEND, env=env, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + "\n" + result.stderr


def test_populated_legacy_documents_stay_unchanged(tmp_path):
    path = tmp_path / "staff_guide_upgrade.sqlite"
    migrate("0015_bar_marketing_areas", path)
    with sqlite3.connect(path) as db:
        dept_id = db.execute("SELECT id FROM departments WHERE name='Bar'").fetchone()[0]
        db.execute("""INSERT INTO department_docs(id,title,department_id,doc_type,body,status,
                      hidden_from_active,created_at,updated_at)
                      VALUES (900,'Old bar instructions',?,'SOP','Legacy text','Active',0,
                      CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)""", (dept_id,))
        db.commit()
        before = db.execute("SELECT id,title,department_id,doc_type,body,status FROM department_docs WHERE id=900").fetchone()
    migrate("0016_staff_guide", path)
    with sqlite3.connect(path) as db:
        after = db.execute("SELECT id,title,department_id,doc_type,body,status FROM department_docs WHERE id=900").fetchone()
        assert before == after
        assert db.execute("SELECT COUNT(*) FROM guide_documents").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM guide_revisions").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM guide_readings").fetchone()[0] == 0
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0016_staff_guide"
