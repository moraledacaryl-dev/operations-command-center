from __future__ import annotations

from sqlalchemy import CheckConstraint, Index, UniqueConstraint

from . import models
from . import foundation_models as foundation


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


def _add_check(model, name: str, expression: str) -> None:
    table = model.__table__
    if not _has_named_constraint(table, name):
        table.append_constraint(CheckConstraint(expression, name=name))


_add_check(models.RoomArea, "ck_rooms_kind", "kind IN ('room', 'area')")
_add_check(models.RoomArea, "ck_rooms_status", "status IN ('active', 'inactive', 'maintenance')")
_add_check(models.Project, "ck_projects_status", "status IN ('Planned', 'Active', 'Paused', 'Done')")
_add_check(models.Project, "ck_projects_priority", "priority IN ('Low', 'Normal', 'High', 'Urgent')")
_add_check(models.Task, "ck_tasks_status", "status IN ('To Do', 'Doing', 'Review', 'Done')")
_add_check(models.Task, "ck_tasks_priority", "priority IN ('Low', 'Normal', 'High', 'Urgent')")
_add_check(models.ShiftNote, "ck_shift_notes_status", "status IN ('New', 'Seen', 'Follow', 'Done')")
_add_check(models.ShiftNote, "ck_shift_notes_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')")
_add_check(models.GuestNote, "ck_guest_notes_status", "status IN ('Open', 'Follow', 'Done')")
_add_check(models.GuestNote, "ck_guest_notes_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')")
_add_check(models.Fix, "ck_fixes_status", "status IN ('Open', 'Working', 'Done', 'Verified')")
_add_check(models.Fix, "ck_fixes_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')")
_add_check(models.Post, "ck_posts_status", "status IN ('Idea', 'Draft', 'Review', 'Fix', 'OK', 'Set', 'Posted')")
_add_check(models.Post, "ck_posts_platform", "platform IS NULL OR platform IN ('Facebook', 'Instagram', 'TikTok', 'Google Business', 'Website', 'Internal')")
_add_check(models.Post, "ck_posts_content_type", "content_type IS NULL OR content_type IN ('Reel', 'Story', 'Static', 'Carousel', 'Ad', 'Blog')")
_add_check(models.Request, "ck_requests_status", "status IN ('Draft', 'Review', 'Approved', 'Rejected', 'Planned', 'Done')")
_add_check(models.Request, "ck_requests_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')")
_add_check(models.Approval, "ck_approvals_status", "status IN ('Pending', 'Approved', 'Rejected')")
_add_check(models.Approval, "ck_approvals_priority", "priority IN ('Low', 'Normal', 'High', 'Urgent')")
_add_check(foundation.MarketingCampaign, "ck_marketing_campaigns_status", "status IN ('Planning', 'Active', 'Paused', 'Completed', 'Archived')")
_add_check(foundation.ContentConcept, "ck_content_concepts_status", "status IN ('Idea', 'Active', 'Completed', 'Archived')")
_add_check(foundation.PlatformDeliverable, "ck_platform_deliverables_platform", "platform IN ('Facebook', 'Instagram', 'TikTok', 'Google Business', 'Website', 'Internal')")
_add_check(foundation.PlatformDeliverable, "ck_platform_deliverables_format", "format IN ('Reel', 'Story', 'Static', 'Carousel', 'Ad', 'Blog')")
_add_check(foundation.PlatformDeliverable, "ck_platform_deliverables_status", "status IN ('Planned', 'Draft', 'Review', 'Fix', 'Approved', 'Scheduled', 'Published')")

if not _has_named_index(table, "uq_user_departments_one_primary"):
    Index(
        "uq_user_departments_one_primary",
        table.c.user_id,
        unique=True,
        postgresql_where=table.c.is_primary.is_(True),
        sqlite_where=table.c.is_primary.is_(True),
    )
