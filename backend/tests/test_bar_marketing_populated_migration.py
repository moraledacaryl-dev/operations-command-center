"""Regression: adding Bar and Marketing area labels must never move existing work.

Uses a real Alembic 0014 -> 0015 upgrade on a temporary *populated* SQLite
database. This is not production data or a substitute for PostgreSQL rehearsal.
"""
import os
from pathlib import Path
import sqlite3
import subprocess
import sys


BACKEND = Path(__file__).resolve().parents[1]


def migrate(revision: str, db_path: Path) -> None:
    env = dict(os.environ, ENVIRONMENT="test", DATABASE_URL="sqlite:///" + str(db_path),
               ALLOW_DEFAULT_ADMIN_BOOTSTRAP="false")
    result = subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", revision],
                            cwd=BACKEND, env=env, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + "\n" + result.stderr


def test_upgrade_keeps_legacy_cafe_kitchen_marketing_work(tmp_path):
    db_path = tmp_path / "migration_preserve_existing.sqlite"
    migrate("0014_room_stays", db_path)
    with sqlite3.connect(db_path) as conn:
        # Include old work from multiple departments and all four affected tables.
        conn.execute("""INSERT INTO departments (id, name, short_name, created_at, updated_at)
                        VALUES (12, 'Café', 'CAFE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                               (13, 'Kitchen', 'KIT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                               (14, 'Marketing', 'MKT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""")
        conn.execute("""INSERT INTO tasks (id, title, department_id, status, priority,
                         hidden_from_active, created_at, updated_at)
                        VALUES (91, 'Earlier Café opening', 12, 'To Do', 'Normal', 0,
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                               (92, 'Earlier Kitchen cleaning', 13, 'Doing', 'High', 0,
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
                               (93, 'Earlier Marketing event', 14, 'Review', 'Normal', 0,
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""")
        conn.execute("""INSERT INTO posts (id, title, department_id, status, hidden_from_active,
                         created_at, updated_at)
                        VALUES (94, 'Old event artwork', 14, 'Draft', 0,
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""")
        conn.execute("""INSERT INTO marketing_campaigns (id, department_id, name, status,
                         created_at, updated_at)
                        VALUES (95, 14, 'Existing promotional campaign', 'Planning',
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""")
        conn.execute("""INSERT INTO content_concepts (id, campaign_id, content_pillar, title, status,
                         created_at, updated_at)
                        VALUES (96, 95, 'Experience', 'Existing pool post', 'Idea',
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""")
        conn.commit()
        before = {
            "departments": conn.execute("SELECT id,name,short_name FROM departments ORDER BY id").fetchall(),
            "tasks": conn.execute("SELECT id,title,department_id,status,priority FROM tasks ORDER BY id").fetchall(),
            "posts": conn.execute("SELECT id,title,department_id,status FROM posts ORDER BY id").fetchall(),
            "marketing_campaigns": conn.execute("SELECT id,name,department_id,status FROM marketing_campaigns ORDER BY id").fetchall(),
            "content_concepts": conn.execute("SELECT id,campaign_id,title,status FROM content_concepts ORDER BY id").fetchall(),
        }
    migrate("0015_bar_marketing_areas", db_path)
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0015_bar_marketing_areas"
        assert conn.execute("SELECT count(*) FROM departments WHERE name='Bar'").fetchone()[0] == 1
        assert conn.execute("SELECT id,name,short_name FROM departments WHERE name != 'Bar' ORDER BY id").fetchall() == before["departments"]
        assert conn.execute("SELECT id,title,department_id,status,priority FROM tasks ORDER BY id").fetchall() == before["tasks"]
        assert conn.execute("SELECT id,title,department_id,status FROM posts ORDER BY id").fetchall() == before["posts"]
        assert conn.execute("SELECT id,name,department_id,status FROM marketing_campaigns ORDER BY id").fetchall() == before["marketing_campaigns"]
        assert conn.execute("SELECT id,campaign_id,title,status FROM content_concepts ORDER BY id").fetchall() == before["content_concepts"]
        for table in ("tasks", "posts", "marketing_campaigns", "content_concepts"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table} WHERE marketing_areas IS NOT NULL").fetchone()[0] == 0
        # A second application of the requested revision is idempotent.
    migrate("head", db_path)
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT count(*) FROM departments WHERE name='Bar'").fetchone()[0] == 1
        assert conn.execute("SELECT department_id FROM tasks WHERE id=92").fetchone()[0] == 13
