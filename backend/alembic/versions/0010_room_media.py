"""add owner-managed room media

Revision ID: 0010_room_media
Revises: 0009_property_media
"""

from alembic import op
import sqlalchemy as sa

revision = "0010_room_media"
down_revision = "0009_property_media"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "room_media",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("room_area_id", sa.Integer(), sa.ForeignKey("rooms_areas.id"), nullable=False),
        sa.Column("filename", sa.String(length=220), nullable=False),
        sa.Column("file_url", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("room_area_id", name="uq_room_media_room_area_id"),
    )


def downgrade():
    op.drop_table("room_media")
