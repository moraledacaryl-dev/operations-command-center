"""durable session generation and login throttle state

Revision ID: 0005_session_security
Revises: 0004_api_state_integrity
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_session_security"
down_revision = "0004_api_state_integrity"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "session_version" not in _columns("users"):
        op.add_column(
            "users",
            sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
        )

    if "login_failure_events" not in _tables():
        op.create_table(
            "login_failure_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("key_hash", sa.String(length=64), nullable=False),
            sa.Column("occurred_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            "ix_login_failure_events_key_time",
            "login_failure_events",
            ["key_hash", "occurred_at"],
        )


def downgrade() -> None:
    if "login_failure_events" in _tables():
        indexes = {
            row["name"]
            for row in sa.inspect(op.get_bind()).get_indexes("login_failure_events")
            if row.get("name")
        }
        if "ix_login_failure_events_key_time" in indexes:
            op.drop_index("ix_login_failure_events_key_time", table_name="login_failure_events")
        op.drop_table("login_failure_events")

    if "session_version" in _columns("users"):
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("users", recreate="always") as batch:
                batch.drop_column("session_version")
        else:
            op.drop_column("users", "session_version")
