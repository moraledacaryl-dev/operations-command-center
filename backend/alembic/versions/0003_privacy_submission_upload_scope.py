"""privacy, submission scope, and upload integrity

Revision ID: 0003_privacy_submission_upload
Revises: 0002_integration_identity
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_privacy_submission_upload"
down_revision = "0002_integration_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("submissions") as batch:
        batch.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_submissions_department_id_departments",
            "departments",
            ["department_id"],
            ["id"],
        )
        batch.create_index("ix_submissions_department_review", ["department_id", "review_status"])

    # Backfill only when a linked operational record provides an unambiguous
    # department. Truly organization-wide submissions intentionally remain NULL.
    op.execute(
        sa.text(
            """
            UPDATE submissions
            SET department_id = COALESCE(
                (SELECT department_id FROM tasks WHERE tasks.id = submissions.linked_task_id),
                (SELECT department_id FROM guest_notes WHERE guest_notes.id = submissions.linked_guest_note_id),
                (SELECT department_id FROM fixes WHERE fixes.id = submissions.linked_fix_id),
                (SELECT department_id FROM posts WHERE posts.id = submissions.linked_post_id)
            )
            WHERE department_id IS NULL
            """
        )
    )

    with op.batch_alter_table("post_versions") as batch:
        batch.create_unique_constraint(
            "uq_post_version_number",
            ["post_id", "version_no"],
        )


def downgrade() -> None:
    with op.batch_alter_table("post_versions") as batch:
        batch.drop_constraint("uq_post_version_number", type_="unique")

    with op.batch_alter_table("submissions") as batch:
        batch.drop_index("ix_submissions_department_review")
        batch.drop_constraint("fk_submissions_department_id_departments", type_="foreignkey")
        batch.drop_column("department_id")
