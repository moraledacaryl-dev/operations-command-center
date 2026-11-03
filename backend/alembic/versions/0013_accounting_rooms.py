"""Minimum-data Accounting room booking snapshots.

Revision ID: 0013_accounting_rooms
Revises: 0012_event_turnover
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_accounting_rooms"
down_revision = "0012_event_turnover"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("accounting_room_bookings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.String(80), nullable=False, unique=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("accounting_room_id", sa.Integer(), nullable=True),
        sa.Column("room_ids_json", sa.Text(), nullable=False),
        sa.Column("check_in", sa.String(10), nullable=True),
        sa.Column("check_out", sa.String(10), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("origin", sa.String(24), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_accounting_room_bookings_check_out", "accounting_room_bookings", ["check_out"])


def downgrade():
    op.drop_index("ix_accounting_room_bookings_check_out", table_name="accounting_room_bookings")
    op.drop_table("accounting_room_bookings")
