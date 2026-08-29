from __future__ import annotations

from sqlalchemy import Index, UniqueConstraint

from . import models


def _has_named_constraint(table, name: str) -> bool:
    return any(getattr(constraint, "name", None) == name for constraint in table.constraints)


def _has_named_index(table, name: str) -> bool:
    return any(getattr(index, "name", None) == name for index in table.indexes)


table = models.UserDepartment.__table__

if not _has_named_constraint(table, "uq_user_departments_user_department"):
    table.append_constraint(
        UniqueConstraint(
            table.c.user_id,
            table.c.department_id,
            name="uq_user_departments_user_department",
        )
    )

if not _has_named_index(table, "uq_user_departments_one_primary"):
    Index(
        "uq_user_departments_one_primary",
        table.c.user_id,
        unique=True,
        postgresql_where=table.c.is_primary.is_(True),
        sqlite_where=table.c.is_primary.is_(True),
    )
