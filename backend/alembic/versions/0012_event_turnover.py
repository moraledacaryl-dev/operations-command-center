"""Accounting event project linkage and housekeeping room-turnover workflow.

Revision ID: 0012_event_turnover
Revises: 0011_project_collaboration
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_event_turnover"
down_revision = "0011_project_collaboration"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("event_project_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_app", sa.String(80), nullable=False),
        sa.Column("source_record_id", sa.String(80), nullable=False),
        sa.Column("event_no", sa.String(100), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source_app", "source_record_id", name="uq_event_project_source"),
        sa.UniqueConstraint("project_id", name="uq_event_project_project_id"))
    op.create_table("room_turnovers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("room_area_id", sa.Integer(), sa.ForeignKey("rooms_areas.id"), nullable=False),
        sa.Column("service_date", sa.String(10), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("vacated_confirmed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("vacated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("vacated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rework_note", sa.Text(), nullable=True),
        sa.Column("items_json", sa.Text(), nullable=False),
        sa.Column("started_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("inspected_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("inspected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("room_area_id", "service_date", name="uq_room_turnover_date"))
    op.create_index("ix_room_turnovers_date_status", "room_turnovers", ["service_date", "status"])


def downgrade():
    op.drop_index("ix_room_turnovers_date_status", table_name="room_turnovers")
    op.drop_table("room_turnovers")
    op.drop_table("event_project_links")
