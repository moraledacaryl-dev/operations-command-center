"""production foundation

Revision ID: 0001_production_foundation
Revises:
Create Date: 2026-07-20
"""

from pathlib import Path
import runpy

from alembic import op
from sqlalchemy import inspect, text


revision = "0001_production_foundation"
down_revision = None
branch_labels = None
depends_on = None

# The original revision imported current Base.metadata, which made historical DDL
# change whenever application models changed. Load a migration-owned snapshot of
# the exact schema from the commit that introduced this revision instead.
_FROZEN_SCHEMA = Path(__file__).resolve().parents[1] / "frozen_schema_0001.py"
FROZEN_METADATA = runpy.run_path(str(_FROZEN_SCHEMA))["metadata"]


def _add_column_if_missing(table_name: str, column_sql: str) -> None:
    """Compatibility shim for databases that predate Alembic revision 0001."""
    bind = op.get_bind()
    inspector = inspect(bind)
    if table_name not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns(table_name)}
    column_name = column_sql.split()[0]
    if column_name not in existing:
        bind.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}"))


def upgrade() -> None:
    bind = op.get_bind()

    # This metadata is frozen to the historical 0001 schema and must never be
    # regenerated from live application models. create_all remains useful here
    # because the original schema contains circular foreign keys and revision
    # 0001 also supported pre-Alembic installations with some existing tables.
    FROZEN_METADATA.create_all(bind=bind)

    _add_column_if_missing("guest_notes", "department_id INTEGER")
    _add_column_if_missing("fixes", "department_id INTEGER")
    _add_column_if_missing("posts", "department_id INTEGER")
    _add_column_if_missing("users", "password_hash VARCHAR(255)")
    _add_column_if_missing("users", "password_set_at DATETIME")
    _add_column_if_missing("users", "last_login_at DATETIME")

    bind.execute(text("UPDATE guest_notes SET department_id = (SELECT id FROM departments WHERE name = 'Front Desk') WHERE department_id IS NULL"))
    bind.execute(text("UPDATE fixes SET department_id = (SELECT id FROM departments WHERE name = 'Maintenance') WHERE department_id IS NULL"))
    bind.execute(text("UPDATE posts SET department_id = (SELECT id FROM departments WHERE name = 'Marketing') WHERE department_id IS NULL"))


def downgrade() -> None:
    bind = op.get_bind()

    # SQLite cannot ALTER DROP the circular foreign-key constraints emitted by
    # the historical schema. Disable FK enforcement only for this destructive
    # downgrade transaction, then restore it. PostgreSQL can drop the named
    # circular constraints through SQLAlchemy's dependency sorter.
    if bind.dialect.name == "sqlite":
        bind.execute(text("PRAGMA foreign_keys=OFF"))
        try:
            FROZEN_METADATA.drop_all(bind=bind, checkfirst=True)
        finally:
            bind.execute(text("PRAGMA foreign_keys=ON"))
    else:
        FROZEN_METADATA.drop_all(bind=bind, checkfirst=True)
