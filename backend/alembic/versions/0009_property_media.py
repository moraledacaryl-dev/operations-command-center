"""add owner-managed property media

Revision ID: 0009_property_media
Revises: 0008_marketing_workspace
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_property_media"
down_revision = "0008_marketing_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "property_media",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slot", sa.String(length=60), nullable=False),
        sa.Column("filename", sa.String(length=220), nullable=False),
        sa.Column("file_url", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("slot", name="uq_property_media_slot"),
    )


def downgrade() -> None:
    op.drop_table("property_media")
