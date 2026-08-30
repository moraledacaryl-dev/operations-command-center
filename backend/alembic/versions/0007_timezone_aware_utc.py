"""store operational instants as timezone-aware UTC on PostgreSQL

Revision ID: 0007_timezone_aware_utc
Revises: 0006_operational_state_integrity
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_timezone_aware_utc"
down_revision = "0006_operational_state_integrity"
branch_labels = None
depends_on = None


TIMESTAMP_COLUMNS = {
    "departments": ["created_at", "updated_at"],
    "fixes": ["verified_at", "created_at", "updated_at", "completed_at", "archived_at"],
    "guest_notes": ["follow_up_date", "created_at", "updated_at", "completed_at", "archived_at"],
    "integration_deliveries": ["received_at", "processed_at"],
    "integration_event_inbox": ["received_at", "processed_at"],
    "integration_event_outbox": ["created_at", "published_at"],
    "login_failure_events": ["occurred_at"],
    "rooms_areas": ["created_at", "updated_at"],
    "tasks": ["due_date", "created_at", "updated_at", "completed_at", "archived_at"],
    "department_docs": ["created_at", "updated_at", "completed_at", "archived_at"],
    "memos": ["expiry_date", "created_at", "updated_at", "completed_at", "archived_at"],
    "users": ["password_set_at", "last_login_at", "created_at", "updated_at"],
    "activity_events": ["occurred_at"],
    "activity_logs": ["created_at"],
    "approvals": ["decided_at", "created_at", "updated_at", "completed_at", "archived_at"],
    "assignments": ["created_at", "updated_at"],
    "attachments": ["created_at", "updated_at"],
    "comments": ["created_at", "updated_at"],
    "external_user_identities": ["first_seen_at", "last_seen_at"],
    "inbox_items": ["due_at", "seen_at", "resolved_at", "snoozed_until", "created_at", "updated_at"],
    "marketing_campaigns": ["start_at", "end_at", "created_at", "updated_at"],
    "mentions": ["read_at", "created_at", "updated_at"],
    "notifications": ["read_at", "dismissed_at", "created_at", "updated_at"],
    "projects": ["start_date", "due_date", "created_at", "updated_at", "completed_at", "archived_at"],
    "record_relationships": ["created_at", "updated_at"],
    "routine_templates": ["last_generated_at", "created_at", "updated_at", "completed_at", "archived_at"],
    "saved_views": ["created_at", "updated_at"],
    "shift_notes": ["seen_at", "created_at", "updated_at", "completed_at", "archived_at"],
    "talk_messages": ["created_at", "updated_at", "completed_at", "archived_at"],
    "user_departments": ["created_at", "updated_at"],
    "user_preferences": ["created_at", "updated_at"],
    "content_concepts": ["created_at", "updated_at"],
    "external_review_items": ["created_at", "updated_at"],
    "posts": ["post_date", "created_at", "updated_at", "completed_at", "archived_at"],
    "requests": ["created_at", "updated_at", "completed_at", "archived_at"],
    "platform_deliverables": ["scheduled_at", "created_at", "updated_at"],
    "post_versions": ["created_at", "updated_at"],
    "submissions": ["submitted_at", "reviewed_at", "created_at", "updated_at", "completed_at", "archived_at"],
    "assets": ["created_at", "updated_at"],
    "performance_snapshots": ["captured_at", "created_at", "updated_at"],
    "publishing_records": ["scheduled_at", "published_at", "created_at", "updated_at"],
    "asset_versions": ["created_at", "updated_at"],
    "annotations": ["resolved_at", "created_at", "updated_at"],
    "annotation_replies": ["created_at", "updated_at"],
}


def _existing_columns() -> dict[str, set[str]]:
    inspector = sa.inspect(op.get_bind())
    return {
        table: {column["name"] for column in inspector.get_columns(table)}
        for table in inspector.get_table_names()
    }


def _convert(timezone_enabled: bool) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    existing = _existing_columns()
    target = sa.DateTime(timezone=timezone_enabled)
    current = sa.DateTime(timezone=not timezone_enabled)
    for table, columns in TIMESTAMP_COLUMNS.items():
        for column in columns:
            if column not in existing.get(table, set()):
                continue
            expression = f'"{column}" AT TIME ZONE \'UTC\''
            op.alter_column(
                table,
                column,
                existing_type=current,
                type_=target,
                postgresql_using=expression,
            )


def upgrade() -> None:
    _convert(True)


def downgrade() -> None:
    _convert(False)
