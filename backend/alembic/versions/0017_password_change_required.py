"""Require newly created and reset accounts to change their password."""
from alembic import op
import sqlalchemy as sa

revision = "0017_password_change_required"
down_revision = "0016_staff_guide"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("users", "must_change_password")
