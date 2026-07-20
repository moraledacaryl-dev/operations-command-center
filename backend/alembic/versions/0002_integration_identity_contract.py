"""integration identity contract

Revision ID: 0002_integration_identity
Revises: 0001_production_foundation
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_integration_identity"
down_revision = "0001_production_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "external_user_identities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_app", sa.String(length=80), nullable=False),
        sa.Column("external_user_id", sa.String(length=160), nullable=False),
        sa.Column("external_email", sa.String(length=160), nullable=True),
        sa.Column("external_name", sa.String(length=180), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("source_app", "external_user_id", name="uq_external_user_identity_source_id"),
    )
    op.create_index(
        "ix_external_user_identity_user",
        "external_user_identities",
        ["user_id", "source_app"],
    )

    op.create_table(
        "integration_deliveries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_app", sa.String(length=80), nullable=False),
        sa.Column("event_id", sa.String(length=180), nullable=False),
        sa.Column("event_type", sa.String(length=140), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("correlation_id", sa.String(length=180), nullable=True),
        sa.Column("subject_type", sa.String(length=100), nullable=True),
        sa.Column("subject_id", sa.String(length=180), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="received"),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.UniqueConstraint("source_app", "event_id", name="uq_integration_delivery_source_event"),
    )
    op.create_index(
        "ix_integration_delivery_status_received",
        "integration_deliveries",
        ["status", "received_at"],
    )
    op.create_index(
        "ix_integration_delivery_correlation",
        "integration_deliveries",
        ["correlation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_integration_delivery_correlation", table_name="integration_deliveries")
    op.drop_index("ix_integration_delivery_status_received", table_name="integration_deliveries")
    op.drop_table("integration_deliveries")
    op.drop_index("ix_external_user_identity_user", table_name="external_user_identities")
    op.drop_table("external_user_identities")
