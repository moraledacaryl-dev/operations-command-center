"""Store whitelisted event-venue context separately from room turnovers.

Revision ID: 0013_event_venue_work
Revises: 0012_event_turnover
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_event_venue_work"
down_revision = "0012_event_turnover"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("event_project_links", sa.Column("venue", sa.String(80), nullable=True))
    op.add_column("event_project_links", sa.Column("event_date", sa.String(10), nullable=True))


def downgrade():
    op.drop_column("event_project_links", "event_date")
    op.drop_column("event_project_links", "venue")
