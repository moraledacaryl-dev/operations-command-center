"""production foundation

Revision ID: 0001_production_foundation
Revises:
Create Date: 2026-07-20
"""

from alembic import op
from sqlalchemy import inspect, text

from app.database import Base
from app import models  # noqa: F401
from app import foundation_models  # noqa: F401

revision = "0001_production_foundation"
down_revision = None
branch_labels = None
depends_on = None

FOUNDATION_TABLES = [
    "performance_snapshots",
    "publishing_records",
    "annotation_replies",
    "annotations",
    "asset_versions",
    "assets",
    "platform_deliverables",
    "content_concepts",
    "marketing_campaigns",
    "integration_event_outbox",
    "integration_event_inbox",
    "assignments",
    "mentions",
    "user_preferences",
    "saved_views",
    "record_relationships",
    "activity_events",
    "inbox_items",
    "notifications",
]


def _add_column_if_missing(table_name: str, column_sql: str) -> None:
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

    # This first Alembic revision supports both a fresh PostgreSQL database and
    # existing local SQLite databases. Future revisions must use explicit op.*
    # operations and are generated against Base.metadata.
    Base.metadata.create_all(bind=bind)

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
    inspector = inspect(bind)
    existing = set(inspector.get_table_names())
    for table_name in FOUNDATION_TABLES:
        if table_name in existing:
            op.drop_table(table_name)
