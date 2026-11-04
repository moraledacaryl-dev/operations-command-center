"""Record Front Desk arrivals and departures in Operations.

Revision ID: 0014_room_stays
Revises: 0013_accounting_rooms
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_room_stays"
down_revision = "0013_accounting_rooms"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("room_stays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("room_area_id", sa.Integer(), sa.ForeignKey("rooms_areas.id"), nullable=False),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("checked_in_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("checked_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_out_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    op.create_index("ix_room_stays_room_id", "room_stays", ["room_area_id", "id"])
    op.create_index("uq_room_stays_active_room", "room_stays", ["room_area_id"], unique=True,
                    sqlite_where=sa.text("checked_out_at IS NULL AND voided_at IS NULL"), postgresql_where=sa.text("checked_out_at IS NULL AND voided_at IS NULL"))

    op.create_table("room_stay_corrections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stay_id", sa.Integer(), sa.ForeignKey("room_stays.id"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("previous_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("previous_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("corrected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("corrected_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False))
    with op.batch_alter_table("room_turnovers") as batch:
        batch.add_column(sa.Column("cycle", sa.Integer(), nullable=False, server_default="1"))
        batch.drop_constraint("uq_room_turnover_date", type_="unique")
        batch.create_unique_constraint("uq_room_turnover_cycle", ["room_area_id", "service_date", "cycle"])


def downgrade():
    # Downgrade refuses to discard multiple same-day cleaning records.
    with op.batch_alter_table("room_turnovers") as batch:
        batch.drop_constraint("uq_room_turnover_cycle", type_="unique")
        batch.create_unique_constraint("uq_room_turnover_date", ["room_area_id", "service_date"])
        batch.drop_column("cycle")
    op.drop_table("room_stay_corrections")
    op.drop_index("uq_room_stays_active_room", table_name="room_stays")
    op.drop_index("ix_room_stays_room_id", table_name="room_stays")
    op.drop_table("room_stays")
