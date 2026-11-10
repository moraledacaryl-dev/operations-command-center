"""Add Bar without moving old work, and optional explicit Marketing areas.

Revision ID: 0015_bar_marketing_areas
Revises: 0014_room_stays
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_bar_marketing_areas"
down_revision = "0014_room_stays"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    bind.execute(sa.text("""
        INSERT INTO departments (name, short_name, created_at, updated_at)
        SELECT 'Bar', 'BAR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM departments WHERE lower(name) = 'bar')
    """))
    for table in ("marketing_campaigns", "content_concepts", "posts", "tasks"):
        op.add_column(table, sa.Column("marketing_areas", sa.JSON(), nullable=True))


def downgrade():
    # Do not delete Bar records or memberships on rollback.
    for table in ("tasks", "posts", "content_concepts", "marketing_campaigns"):
        op.drop_column(table, "marketing_areas")
