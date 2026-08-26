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


def _dialect_name() -> str:
    return op.get_bind().dialect.name


def _table_columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _table_indexes(table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name) if index.get("name")}


def _unique_column_sets(table_name: str) -> set[tuple[str, ...]]:
    return {
        tuple(constraint.get("column_names") or [])
        for constraint in sa.inspect(op.get_bind()).get_unique_constraints(table_name)
    }


def _foreign_key_names(table_name: str) -> set[str]:
    return {
        fk["name"]
        for fk in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
        if fk.get("name")
    }


def upgrade() -> None:
    # The historical 0001 bootstrap uses Base.metadata.create_all(), so a true
    # fresh database can already contain columns/constraints introduced by later
    # models before Alembic reaches this revision. Inspect the actual schema and
    # add only missing pieces. This also keeps upgrades safe for legacy DBs.
    if "department_id" not in _table_columns("submissions"):
        op.add_column(
            "submissions",
            sa.Column("department_id", sa.Integer(), nullable=True),
        )

    # PostgreSQL supports adding the FK directly. SQLite cannot add a foreign
    # key after table creation without table recreation, which is unsafe here
    # because submissions has several cross-linked foreign keys.
    if _dialect_name() != "sqlite":
        fk_name = "fk_submissions_department_id_departments"
        if fk_name not in _foreign_key_names("submissions"):
            op.create_foreign_key(
                fk_name,
                "submissions",
                "departments",
                ["department_id"],
                ["id"],
            )

    index_name = "ix_submissions_department_review"
    if index_name not in _table_indexes("submissions"):
        op.create_index(
            index_name,
            "submissions",
            ["department_id", "review_status"],
        )

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

    if ("post_id", "version_no") not in _unique_column_sets("post_versions"):
        with op.batch_alter_table("post_versions") as batch:
            batch.create_unique_constraint(
                "uq_post_version_number",
                ["post_id", "version_no"],
            )


def downgrade() -> None:
    if ("post_id", "version_no") in _unique_column_sets("post_versions"):
        with op.batch_alter_table("post_versions") as batch:
            batch.drop_constraint("uq_post_version_number", type_="unique")

    if "ix_submissions_department_review" in _table_indexes("submissions"):
        op.drop_index("ix_submissions_department_review", table_name="submissions")

    if _dialect_name() != "sqlite":
        fk_name = "fk_submissions_department_id_departments"
        if fk_name in _foreign_key_names("submissions"):
            op.drop_constraint(
                fk_name,
                "submissions",
                type_="foreignkey",
            )

    if "department_id" in _table_columns("submissions"):
        op.drop_column("submissions", "department_id")
