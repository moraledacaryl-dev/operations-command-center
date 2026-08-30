"""strict operational domain and state constraints

Revision ID: 0006_operational_state_integrity
Revises: 0005_session_security
Create Date: 2026-08-30
"""

from alembic import op
import sqlalchemy as sa


revision = "0006_operational_state_integrity"
down_revision = "0005_session_security"
branch_labels = None
depends_on = None


CONSTRAINTS: dict[str, list[tuple[str, str]]] = {
    "rooms_areas": [
        ("ck_rooms_kind", "kind IN ('room', 'area')"),
        ("ck_rooms_status", "status IN ('active', 'inactive', 'maintenance')"),
    ],
    "projects": [
        ("ck_projects_status", "status IN ('Planned', 'Active', 'Paused', 'Done')"),
        ("ck_projects_priority", "priority IN ('Low', 'Normal', 'High', 'Urgent')"),
    ],
    "tasks": [
        ("ck_tasks_status", "status IN ('To Do', 'Doing', 'Review', 'Done')"),
        ("ck_tasks_priority", "priority IN ('Low', 'Normal', 'High', 'Urgent')"),
    ],
    "shift_notes": [
        ("ck_shift_notes_status", "status IN ('New', 'Seen', 'Follow', 'Done')"),
        ("ck_shift_notes_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')"),
    ],
    "guest_notes": [
        ("ck_guest_notes_status", "status IN ('Open', 'Follow', 'Done')"),
        ("ck_guest_notes_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')"),
    ],
    "fixes": [
        ("ck_fixes_status", "status IN ('Open', 'Working', 'Done', 'Verified')"),
        ("ck_fixes_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')"),
    ],
    "posts": [
        ("ck_posts_status", "status IN ('Idea', 'Draft', 'Review', 'Fix', 'OK', 'Set', 'Posted')"),
        ("ck_posts_platform", "platform IS NULL OR platform IN ('Facebook', 'Instagram', 'TikTok', 'Google Business', 'Website', 'Internal')"),
        ("ck_posts_content_type", "content_type IS NULL OR content_type IN ('Reel', 'Story', 'Static', 'Carousel', 'Ad', 'Blog')"),
    ],
    "requests": [
        ("ck_requests_status", "status IN ('Draft', 'Review', 'Approved', 'Rejected', 'Planned', 'Done')"),
        ("ck_requests_urgency", "urgency IN ('Low', 'Normal', 'High', 'Urgent')"),
    ],
    "approvals": [
        ("ck_approvals_status", "status IN ('Pending', 'Approved', 'Rejected')"),
        ("ck_approvals_priority", "priority IN ('Low', 'Normal', 'High', 'Urgent')"),
    ],
}


def _existing_checks(table_name: str) -> set[str]:
    return {
        row["name"]
        for row in sa.inspect(op.get_bind()).get_check_constraints(table_name)
        if row.get("name")
    }


def upgrade() -> None:
    for table_name, constraints in CONSTRAINTS.items():
        existing = _existing_checks(table_name)
        missing = [(name, expression) for name, expression in constraints if name not in existing]
        if not missing:
            continue
        with op.batch_alter_table(table_name, recreate="always" if op.get_bind().dialect.name == "sqlite" else "auto") as batch:
            for name, expression in missing:
                batch.create_check_constraint(name, expression)


def downgrade() -> None:
    for table_name, constraints in reversed(list(CONSTRAINTS.items())):
        existing = _existing_checks(table_name)
        removable = [name for name, _ in constraints if name in existing]
        if not removable:
            continue
        with op.batch_alter_table(table_name, recreate="always" if op.get_bind().dialect.name == "sqlite" else "auto") as batch:
            for name in removable:
                batch.drop_constraint(name, type_="check")
