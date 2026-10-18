"""Project discussion replies, votes and purchase budgets."""
from alembic import op
import sqlalchemy as sa

revision = '0011_project_collaboration'
down_revision = '0010_room_media'
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False)]


def upgrade():
    with op.batch_alter_table('comments') as batch:
        batch.add_column(sa.Column('reply_to_id', sa.Integer(), nullable=True))
        batch.create_foreign_key('fk_comment_reply', 'comments', ['reply_to_id'], ['id'])
        batch.create_index('ix_comments_reply_to_id', ['reply_to_id'])
    op.create_table('project_comment_votes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('comment_id', sa.Integer(), sa.ForeignKey('comments.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        *timestamps(), sa.UniqueConstraint('comment_id', 'user_id', name='uq_project_comment_vote'))
    op.create_index('ix_project_comment_votes_comment_id', 'project_comment_votes', ['comment_id'])
    op.create_table('project_budgets',
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), primary_key=True),
        sa.Column('limit_cents', sa.Integer(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('updated_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        *timestamps(), sa.CheckConstraint('limit_cents >= 0', name='ck_project_budget_nonnegative'))
    op.create_table('project_purchase_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('source_comment_id', sa.Integer(), sa.ForeignKey('comments.id'), nullable=True),
        sa.Column('name', sa.String(180), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('unit_price_cents', sa.Integer(), nullable=True),
        sa.Column('actual_total_cents', sa.Integer(), nullable=True),
        sa.Column('category', sa.String(60), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('proposed_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('updated_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False), *timestamps(),
        sa.CheckConstraint('quantity > 0', name='ck_project_purchase_quantity'),
        sa.CheckConstraint('unit_price_cents >= 0', name='ck_project_purchase_price'),
        sa.CheckConstraint('actual_total_cents >= 0', name='ck_project_purchase_actual'),
        sa.CheckConstraint("status IN ('Suggested', 'Planned', 'Purchased', 'Declined')", name='ck_project_purchase_status'))
    op.create_index('ix_project_purchase_items_project_id', 'project_purchase_items', ['project_id'])


def downgrade():
    op.drop_table('project_purchase_items')
    op.drop_table('project_budgets')
    op.drop_table('project_comment_votes')
    with op.batch_alter_table('comments') as batch:
        batch.drop_index('ix_comments_reply_to_id')
        batch.drop_constraint('fk_comment_reply', type_='foreignkey')
        batch.drop_column('reply_to_id')
