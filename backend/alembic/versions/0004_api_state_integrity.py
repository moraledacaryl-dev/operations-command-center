"""API/state integrity constraints

Revision ID: 0004_api_state_integrity
Revises: 0003_privacy_submission_upload
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "0004_api_state_integrity"
down_revision = "0003_privacy_submission_upload"
branch_labels = None
depends_on = None


def _dialect_name() -> str:
    return op.get_bind().dialect.name


def _unique_column_sets(table_name: str) -> set[tuple[str, ...]]:
    return {
        tuple(constraint.get("column_names") or [])
        for constraint in sa.inspect(op.get_bind()).get_unique_constraints(table_name)
    }


def _index_names(table_name: str) -> set[str]:
    return {
        index["name"]
        for index in sa.inspect(op.get_bind()).get_indexes(table_name)
        if index.get("name")
    }


def upgrade() -> None:
    # Collapse duplicate memberships deterministically before adding the pair
    # uniqueness constraint. Keep the oldest row for each user/department pair.
    op.execute(
        sa.text(
            """
            DELETE FROM user_departments
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM user_departments
                GROUP BY user_id, department_id
            )
            """
        )
    )

    # Keep at most one primary membership per user. The oldest primary remains
    # primary so the cleanup is deterministic and does not create a new choice.
    op.execute(
        sa.text(
            """
            UPDATE user_departments
            SET is_primary = FALSE
            WHERE is_primary = TRUE
              AND id NOT IN (
                SELECT MIN(id)
                FROM user_departments
                WHERE is_primary = TRUE
                GROUP BY user_id
              )
            """
        )
    )

    # Synchronize the legacy users.department_id cache with the canonical
    # primary membership when a primary exists.
    op.execute(
        sa.text(
            """
            UPDATE users
            SET department_id = (
                SELECT department_id
                FROM user_departments
                WHERE user_departments.user_id = users.id
                  AND user_departments.is_primary = TRUE
                ORDER BY user_departments.id
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1
                FROM user_departments
                WHERE user_departments.user_id = users.id
                  AND user_departments.is_primary = TRUE
            )
            """
        )
    )

    if ("user_id", "department_id") not in _unique_column_sets("user_departments"):
        with op.batch_alter_table("user_departments") as batch:
            batch.create_unique_constraint(
                "uq_user_departments_user_department",
                ["user_id", "department_id"],
            )

    index_name = "uq_user_departments_one_primary"
    if index_name not in _index_names("user_departments"):
        if _dialect_name() == "postgresql":
            op.create_index(
                index_name,
                "user_departments",
                ["user_id"],
                unique=True,
                postgresql_where=sa.text("is_primary IS TRUE"),
            )
        else:
            op.create_index(
                index_name,
                "user_departments",
                ["user_id"],
                unique=True,
                sqlite_where=sa.text("is_primary = 1"),
            )


def downgrade() -> None:
    index_name = "uq_user_departments_one_primary"
    if index_name in _index_names("user_departments"):
        op.drop_index(index_name, table_name="user_departments")

    if ("user_id", "department_id") in _unique_column_sets("user_departments"):
        with op.batch_alter_table("user_departments") as batch:
            batch.drop_constraint(
                "uq_user_departments_user_department",
                type_="unique",
            )
