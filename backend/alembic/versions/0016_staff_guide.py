"""Controlled Staff Guide with immutable published versions and reading evidence.

Revision ID: 0016_staff_guide
Revises: 0015_bar_marketing_areas
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_staff_guide"
down_revision = "0015_bar_marketing_areas"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("guide_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("doc_type", sa.String(30), nullable=False),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("audience", sa.String(24), nullable=False),
        sa.Column("department_ids", sa.JSON(), nullable=False),
        sa.Column("requires_ack", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("current_revision_id", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_guide_documents_current", "guide_documents", ["current_revision_id"])
    op.create_table("guide_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("guide_documents.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("doc_type", sa.String(30), nullable=False),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("audience", sa.String(24), nullable=False),
        sa.Column("requires_ack", sa.Boolean(), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("document_id", "version", name="uq_guide_document_version"))
    op.create_table("guide_revision_departments",
        sa.Column("revision_id", sa.Integer(), sa.ForeignKey("guide_revisions.id"), primary_key=True),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), primary_key=True))
    op.create_table("guide_acknowledgments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("revision_id", sa.Integer(), sa.ForeignKey("guide_revisions.id"), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "revision_id", name="uq_guide_ack_user_revision"))
    op.create_table("guide_readings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("revision_id", sa.Integer(), sa.ForeignKey("guide_revisions.id"), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_reminded_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "revision_id", name="uq_guide_reading_user_revision"))
    op.create_index("ix_guide_reading_user_revision", "guide_readings", ["user_id", "revision_id"])


def downgrade():
    # CI migration round trips run on empty databases. Protect real published
    # revisions and acknowledgments from a destructive production downgrade.
    bind = op.get_bind()
    for table in ("guide_documents", "guide_revisions", "guide_acknowledgments", "guide_readings"):
        if bind.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar():
            raise RuntimeError("Cannot downgrade a populated Staff Guide. Take an approved backup and migration plan.")
    op.drop_index("ix_guide_reading_user_revision", table_name="guide_readings")
    op.drop_table("guide_readings")
    op.drop_table("guide_acknowledgments")
    op.drop_table("guide_revision_departments")
    op.drop_table("guide_revisions")
    op.drop_index("ix_guide_documents_current", table_name="guide_documents")
    op.drop_table("guide_documents")
