"""Frozen DDL snapshot for Alembic revision 0001_production_foundation.

This module intentionally contains no imports from app.models, app.foundation_models,
or Base.metadata. It represents the schema as it existed in commit
ca7bd5768476adb96025a2bbed26008162ea974c, which introduced revision 0001.

Do not update this file when application models change. New schema changes belong in
new Alembic revisions.
"""

import sqlalchemy as sa


metadata = sa.MetaData()


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def _archive():
    return [
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("hidden_from_active", sa.Boolean(), nullable=False),
        sa.Column("archive_reason", sa.String(length=120), nullable=True),
    ]


def _table(name, *columns, constraints=()):
    return sa.Table(name, metadata, *columns, *constraints)


# Core operational schema from the original 0001 commit.
departments = _table(
    "departments",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("name", sa.String(length=80), nullable=False, unique=True),
    sa.Column("short_name", sa.String(length=40), nullable=True),
    *_timestamps(),
)

users = _table(
    "users",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("name", sa.String(length=120), nullable=False),
    sa.Column("email", sa.String(length=160), nullable=True, unique=True),
    sa.Column("password_hash", sa.String(length=255), nullable=True),
    sa.Column("password_set_at", sa.DateTime(), nullable=True),
    sa.Column("last_login_at", sa.DateTime(), nullable=True),
    sa.Column("role", sa.String(length=40), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("is_active", sa.Boolean(), nullable=False),
    *_timestamps(),
)

user_departments = _table(
    "user_departments",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=False),
    sa.Column("is_primary", sa.Boolean(), nullable=False),
    sa.Column("role_override", sa.String(length=40), nullable=True),
    *_timestamps(),
)

rooms_areas = _table(
    "rooms_areas",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("name", sa.String(length=80), nullable=False),
    sa.Column("kind", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(),
)

projects = _table(
    "projects",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("start_date", sa.DateTime(), nullable=True),
    sa.Column("due_date", sa.DateTime(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("priority", sa.String(length=20), nullable=False),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(), *_archive(),
)

# These four tables contain historical circular references. SQLAlchemy's frozen
# metadata handles creation ordering without relying on live application models.
tasks = _table(
    "tasks",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True),
    sa.Column("linked_guest_note_id", sa.Integer(), sa.ForeignKey("guest_notes.id", name="fk_tasks_linked_guest_note_id_guest_notes"), nullable=True),
    sa.Column("linked_fix_id", sa.Integer(), sa.ForeignKey("fixes.id", name="fk_tasks_linked_fix_id_fixes"), nullable=True),
    sa.Column("linked_post_id", sa.Integer(), sa.ForeignKey("posts.id", name="fk_tasks_linked_post_id_posts"), nullable=True),
    sa.Column("due_date", sa.DateTime(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("priority", sa.String(length=20), nullable=False),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(), *_archive(),
)

guest_notes = _table(
    "guest_notes",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("room_area_id", sa.Integer(), sa.ForeignKey("rooms_areas.id"), nullable=True),
    sa.Column("guest_name", sa.String(length=120), nullable=True),
    sa.Column("issue_type", sa.String(length=40), nullable=True),
    sa.Column("urgency", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("action_taken", sa.Text(), nullable=True),
    sa.Column("follow_up_date", sa.DateTime(), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    sa.Column("linked_task_id", sa.Integer(), sa.ForeignKey("tasks.id", name="fk_guest_notes_linked_task_id_tasks"), nullable=True),
    sa.Column("linked_fix_id", sa.Integer(), sa.ForeignKey("fixes.id", name="fk_guest_notes_linked_fix_id_fixes"), nullable=True),
    *_timestamps(), *_archive(),
)

fixes = _table(
    "fixes",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("room_area_id", sa.Integer(), sa.ForeignKey("rooms_areas.id"), nullable=True),
    sa.Column("problem", sa.Text(), nullable=True),
    sa.Column("urgency", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("reported_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("verified_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("verified_at", sa.DateTime(), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    sa.Column("linked_guest_note_id", sa.Integer(), sa.ForeignKey("guest_notes.id", name="fk_fixes_linked_guest_note_id_guest_notes"), nullable=True),
    sa.Column("linked_task_id", sa.Integer(), sa.ForeignKey("tasks.id", name="fk_fixes_linked_task_id_tasks"), nullable=True),
    *_timestamps(), *_archive(),
)

posts = _table(
    "posts",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("platform", sa.String(length=40), nullable=True),
    sa.Column("post_date", sa.DateTime(), nullable=True),
    sa.Column("content_type", sa.String(length=40), nullable=True),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True),
    sa.Column("campaign", sa.String(length=120), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("caption", sa.Text(), nullable=True),
    sa.Column("final_url", sa.Text(), nullable=True),
    sa.Column("results_json", sa.Text(), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(), *_archive(),
)

shift_notes = _table(
    "shift_notes",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("shift", sa.String(length=40), nullable=True),
    sa.Column("category", sa.String(length=40), nullable=True),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("urgency", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("note", sa.Text(), nullable=True),
    sa.Column("linked_task_id", sa.Integer(), sa.ForeignKey("tasks.id"), nullable=True),
    sa.Column("linked_guest_note_id", sa.Integer(), sa.ForeignKey("guest_notes.id"), nullable=True),
    sa.Column("linked_fix_id", sa.Integer(), sa.ForeignKey("fixes.id"), nullable=True),
    sa.Column("seen_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("seen_at", sa.DateTime(), nullable=True),
    *_timestamps(), *_archive(),
)

post_versions = _table(
    "post_versions",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("post_id", sa.Integer(), sa.ForeignKey("posts.id"), nullable=False),
    sa.Column("version_no", sa.Integer(), nullable=False),
    sa.Column("filename", sa.String(length=220), nullable=True),
    sa.Column("file_url", sa.Text(), nullable=True),
    sa.Column("caption_snapshot", sa.Text(), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("is_current", sa.Boolean(), nullable=False),
    *_timestamps(),
)

approvals = _table(
    "approvals",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("source_type", sa.String(length=40), nullable=True),
    sa.Column("source_id", sa.Integer(), nullable=True),
    sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("priority", sa.String(length=20), nullable=False),
    sa.Column("decision_note", sa.Text(), nullable=True),
    sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("decided_at", sa.DateTime(), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(), *_archive(),
)

memos = _table(
    "memos",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("message", sa.Text(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("expiry_date", sa.DateTime(), nullable=True),
    sa.Column("must_ack", sa.Boolean(), nullable=False),
    *_timestamps(), *_archive(),
)

submissions = _table(
    "submissions",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("source_app", sa.String(length=40), nullable=False),
    sa.Column("source_type", sa.String(length=40), nullable=True),
    sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("submitted_at", sa.DateTime(), nullable=False),
    sa.Column("requires_review", sa.Boolean(), nullable=False),
    sa.Column("review_status", sa.String(length=40), nullable=False),
    sa.Column("reviewed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("reviewed_at", sa.DateTime(), nullable=True),
    sa.Column("payload_json", sa.Text(), nullable=True),
    sa.Column("linked_task_id", sa.Integer(), sa.ForeignKey("tasks.id"), nullable=True),
    sa.Column("linked_guest_note_id", sa.Integer(), sa.ForeignKey("guest_notes.id"), nullable=True),
    sa.Column("linked_fix_id", sa.Integer(), sa.ForeignKey("fixes.id"), nullable=True),
    sa.Column("linked_post_id", sa.Integer(), sa.ForeignKey("posts.id"), nullable=True),
    sa.Column("linked_room_area_id", sa.Integer(), sa.ForeignKey("rooms_areas.id"), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(), *_archive(),
)

external_review_items = _table(
    "external_review_items",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("external_source", sa.String(length=80), nullable=False),
    sa.Column("external_id", sa.String(length=200), nullable=False),
    sa.Column("event_type", sa.String(length=120), nullable=False),
    sa.Column("source_app", sa.String(length=80), nullable=False),
    sa.Column("source_record_type", sa.String(length=120), nullable=True),
    sa.Column("source_record_id", sa.String(length=120), nullable=True),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("summary", sa.Text(), nullable=True),
    sa.Column("priority", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("payload_json", sa.Text(), nullable=True),
    sa.Column("linked_task_id", sa.Integer(), sa.ForeignKey("tasks.id"), nullable=True),
    sa.Column("linked_approval_id", sa.Integer(), sa.ForeignKey("approvals.id"), nullable=True),
    *_timestamps(),
    constraints=(sa.UniqueConstraint("external_source", "external_id", name="uq_external_review_item_external_event"),),
)

requests = _table(
    "requests",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("request_type", sa.String(length=60), nullable=False),
    sa.Column("urgency", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("reason", sa.Text(), nullable=True),
    sa.Column("decision", sa.Text(), nullable=True),
    sa.Column("linked_task_id", sa.Integer(), sa.ForeignKey("tasks.id"), nullable=True),
    sa.Column("linked_project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True),
    sa.Column("external_accounting_ref", sa.String(length=180), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(), *_archive(),
)

talk_messages = _table(
    "talk_messages",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("parent_type", sa.String(length=40), nullable=False),
    sa.Column("parent_id", sa.Integer(), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("message_type", sa.String(length=40), nullable=False),
    sa.Column("body", sa.Text(), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    *_timestamps(), *_archive(),
)

department_docs = _table(
    "department_docs",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("doc_type", sa.String(length=40), nullable=False),
    sa.Column("body", sa.Text(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    *_timestamps(), *_archive(),
)

routine_templates = _table(
    "routine_templates",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("frequency", sa.String(length=40), nullable=False),
    sa.Column("checklist", sa.Text(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("priority", sa.String(length=20), nullable=False),
    sa.Column("last_generated_at", sa.DateTime(), nullable=True),
    *_timestamps(), *_archive(),
)

comments = _table(
    "comments",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("parent_type", sa.String(length=40), nullable=False),
    sa.Column("parent_id", sa.Integer(), nullable=False),
    sa.Column("comment_type", sa.String(length=40), nullable=False),
    sa.Column("body", sa.Text(), nullable=False),
    sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    *_timestamps(),
)

attachments = _table(
    "attachments",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("parent_type", sa.String(length=40), nullable=False),
    sa.Column("parent_id", sa.Integer(), nullable=False),
    sa.Column("filename", sa.String(length=220), nullable=False),
    sa.Column("file_url", sa.Text(), nullable=True),
    sa.Column("mime_type", sa.String(length=120), nullable=True),
    sa.Column("version_no", sa.Integer(), nullable=True),
    sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    *_timestamps(),
)

activity_logs = _table(
    "activity_logs",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("entity_type", sa.String(length=40), nullable=False),
    sa.Column("entity_id", sa.Integer(), nullable=False),
    sa.Column("action", sa.String(length=80), nullable=False),
    sa.Column("message", sa.Text(), nullable=True),
    sa.Column("metadata_json", sa.Text(), nullable=True),
    sa.Column("created_at", sa.DateTime(), nullable=False),
)

# Durable foundation schema from backend/app/foundation_models.py at the same commit.
notifications = _table(
    "notifications",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("kind", sa.String(length=80), nullable=False),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("body", sa.Text(), nullable=True),
    sa.Column("source_type", sa.String(length=80), nullable=True),
    sa.Column("source_id", sa.String(length=120), nullable=True),
    sa.Column("action_url", sa.Text(), nullable=True),
    sa.Column("read_at", sa.DateTime(), nullable=True),
    sa.Column("dismissed_at", sa.DateTime(), nullable=True),
    sa.Column("priority", sa.String(length=20), nullable=False),
    sa.Column("metadata_json", sa.Text(), nullable=True),
    *_timestamps(),
)
sa.Index("ix_notifications_user_unread", notifications.c.user_id, notifications.c.read_at)

inbox_items = _table(
    "inbox_items",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("source_app", sa.String(length=80), nullable=False),
    sa.Column("source_type", sa.String(length=80), nullable=False),
    sa.Column("source_id", sa.String(length=160), nullable=False),
    sa.Column("event_key", sa.String(length=180), nullable=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("summary", sa.Text(), nullable=True),
    sa.Column("category", sa.String(length=60), nullable=False),
    sa.Column("priority", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("due_at", sa.DateTime(), nullable=True),
    sa.Column("seen_at", sa.DateTime(), nullable=True),
    sa.Column("resolved_at", sa.DateTime(), nullable=True),
    sa.Column("snoozed_until", sa.DateTime(), nullable=True),
    sa.Column("action_url", sa.Text(), nullable=True),
    sa.Column("payload_json", sa.Text(), nullable=True),
    *_timestamps(),
    constraints=(sa.UniqueConstraint("source_app", "source_type", "source_id", "event_key", name="uq_inbox_source_event"),),
)
sa.Index("ix_inbox_status_priority_due", inbox_items.c.status, inbox_items.c.priority, inbox_items.c.due_at)

activity_events = _table(
    "activity_events",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("entity_type", sa.String(length=80), nullable=False),
    sa.Column("entity_id", sa.String(length=120), nullable=False),
    sa.Column("event_type", sa.String(length=100), nullable=False),
    sa.Column("summary", sa.Text(), nullable=True),
    sa.Column("metadata_json", sa.Text(), nullable=True),
    sa.Column("occurred_at", sa.DateTime(), nullable=False),
)
sa.Index("ix_activity_entity_time", activity_events.c.entity_type, activity_events.c.entity_id, activity_events.c.occurred_at)

record_relationships = _table(
    "record_relationships",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("from_type", sa.String(length=80), nullable=False),
    sa.Column("from_id", sa.String(length=120), nullable=False),
    sa.Column("to_type", sa.String(length=80), nullable=False),
    sa.Column("to_id", sa.String(length=120), nullable=False),
    sa.Column("relationship_type", sa.String(length=80), nullable=False),
    sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    *_timestamps(),
    constraints=(sa.UniqueConstraint("from_type", "from_id", "to_type", "to_id", "relationship_type", name="uq_record_relationship"),),
)
sa.Index("ix_record_relationship_from", record_relationships.c.from_type, record_relationships.c.from_id)
sa.Index("ix_record_relationship_to", record_relationships.c.to_type, record_relationships.c.to_id)

saved_views = _table(
    "saved_views",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("workspace", sa.String(length=80), nullable=False),
    sa.Column("name", sa.String(length=120), nullable=False),
    sa.Column("is_default", sa.Boolean(), nullable=False),
    sa.Column("definition_json", sa.Text(), nullable=False),
    *_timestamps(),
    constraints=(sa.UniqueConstraint("user_id", "workspace", "name", name="uq_saved_view_user_workspace_name"),),
)

user_preferences = _table(
    "user_preferences",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("preference_key", sa.String(length=120), nullable=False),
    sa.Column("value_json", sa.Text(), nullable=True),
    *_timestamps(),
    constraints=(sa.UniqueConstraint("user_id", "preference_key", name="uq_user_preference_key"),),
)

mentions = _table(
    "mentions",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("mentioned_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("mentioned_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("parent_type", sa.String(length=80), nullable=False),
    sa.Column("parent_id", sa.String(length=120), nullable=False),
    sa.Column("body", sa.Text(), nullable=True),
    sa.Column("read_at", sa.DateTime(), nullable=True),
    *_timestamps(),
)

assignments = _table(
    "assignments",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("entity_type", sa.String(length=80), nullable=False),
    sa.Column("entity_id", sa.String(length=120), nullable=False),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("assigned_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("role", sa.String(length=60), nullable=False),
    sa.Column("active", sa.Boolean(), nullable=False),
    *_timestamps(),
)
sa.Index("ix_assignments_entity_active", assignments.c.entity_type, assignments.c.entity_id, assignments.c.active)

integration_event_inbox = _table(
    "integration_event_inbox",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("source_app", sa.String(length=80), nullable=False),
    sa.Column("external_event_id", sa.String(length=180), nullable=False),
    sa.Column("event_type", sa.String(length=120), nullable=False),
    sa.Column("payload_json", sa.Text(), nullable=False),
    sa.Column("received_at", sa.DateTime(), nullable=False),
    sa.Column("processed_at", sa.DateTime(), nullable=True),
    sa.Column("attempts", sa.Integer(), nullable=False),
    sa.Column("last_error", sa.Text(), nullable=True),
    constraints=(sa.UniqueConstraint("source_app", "external_event_id", name="uq_integration_inbox_event"),),
)

integration_event_outbox = _table(
    "integration_event_outbox",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("target_app", sa.String(length=80), nullable=False),
    sa.Column("event_type", sa.String(length=120), nullable=False),
    sa.Column("aggregate_type", sa.String(length=80), nullable=False),
    sa.Column("aggregate_id", sa.String(length=120), nullable=False),
    sa.Column("payload_json", sa.Text(), nullable=False),
    sa.Column("created_at", sa.DateTime(), nullable=False),
    sa.Column("published_at", sa.DateTime(), nullable=True),
    sa.Column("attempts", sa.Integer(), nullable=False),
    sa.Column("last_error", sa.Text(), nullable=True),
)
sa.Index("ix_integration_outbox_pending", integration_event_outbox.c.published_at, integration_event_outbox.c.created_at)

marketing_campaigns = _table(
    "marketing_campaigns",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("name", sa.String(length=180), nullable=False),
    sa.Column("objective", sa.Text(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("start_at", sa.DateTime(), nullable=True),
    sa.Column("end_at", sa.DateTime(), nullable=True),
    sa.Column("budget_note", sa.Text(), nullable=True),
    *_timestamps(),
)

content_concepts = _table(
    "content_concepts",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("marketing_campaigns.id"), nullable=False),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("brief", sa.Text(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    *_timestamps(),
)

platform_deliverables = _table(
    "platform_deliverables",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("concept_id", sa.Integer(), sa.ForeignKey("content_concepts.id"), nullable=False),
    sa.Column("platform", sa.String(length=60), nullable=False),
    sa.Column("format", sa.String(length=60), nullable=False),
    sa.Column("dimensions", sa.String(length=60), nullable=True),
    sa.Column("caption", sa.Text(), nullable=True),
    sa.Column("call_to_action", sa.Text(), nullable=True),
    sa.Column("hashtags", sa.Text(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("scheduled_at", sa.DateTime(), nullable=True),
    sa.Column("final_url", sa.Text(), nullable=True),
    *_timestamps(),
)

assets = _table(
    "assets",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("deliverable_id", sa.Integer(), sa.ForeignKey("platform_deliverables.id"), nullable=True),
    sa.Column("title", sa.String(length=180), nullable=False),
    sa.Column("asset_type", sa.String(length=60), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("current_version_id", sa.Integer(), nullable=True),
    *_timestamps(),
)

asset_versions = _table(
    "asset_versions",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("asset_id", sa.Integer(), sa.ForeignKey("assets.id"), nullable=False),
    sa.Column("version_no", sa.Integer(), nullable=False),
    sa.Column("filename", sa.String(length=220), nullable=False),
    sa.Column("storage_key", sa.Text(), nullable=False),
    sa.Column("mime_type", sa.String(length=120), nullable=True),
    sa.Column("size_bytes", sa.Integer(), nullable=True),
    sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("note", sa.Text(), nullable=True),
    *_timestamps(),
    constraints=(sa.UniqueConstraint("asset_id", "version_no", name="uq_asset_version_number"),),
)

annotations = _table(
    "annotations",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("asset_version_id", sa.Integer(), sa.ForeignKey("asset_versions.id"), nullable=False),
    sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("annotation_type", sa.String(length=40), nullable=False),
    sa.Column("x_ratio", sa.String(length=32), nullable=True),
    sa.Column("y_ratio", sa.String(length=32), nullable=True),
    sa.Column("drawing_json", sa.Text(), nullable=True),
    sa.Column("body", sa.Text(), nullable=False),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("resolved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("resolved_at", sa.DateTime(), nullable=True),
    *_timestamps(),
)

annotation_replies = _table(
    "annotation_replies",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("annotation_id", sa.Integer(), sa.ForeignKey("annotations.id"), nullable=False),
    sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    sa.Column("body", sa.Text(), nullable=False),
    *_timestamps(),
)

publishing_records = _table(
    "publishing_records",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("deliverable_id", sa.Integer(), sa.ForeignKey("platform_deliverables.id"), nullable=False),
    sa.Column("scheduled_at", sa.DateTime(), nullable=True),
    sa.Column("published_at", sa.DateTime(), nullable=True),
    sa.Column("status", sa.String(length=40), nullable=False),
    sa.Column("external_post_id", sa.String(length=180), nullable=True),
    sa.Column("published_url", sa.Text(), nullable=True),
    sa.Column("failure_reason", sa.Text(), nullable=True),
    *_timestamps(),
)

performance_snapshots = _table(
    "performance_snapshots",
    sa.Column("id", sa.Integer(), primary_key=True),
    sa.Column("deliverable_id", sa.Integer(), sa.ForeignKey("platform_deliverables.id"), nullable=False),
    sa.Column("captured_at", sa.DateTime(), nullable=False),
    sa.Column("reach", sa.Integer(), nullable=True),
    sa.Column("impressions", sa.Integer(), nullable=True),
    sa.Column("engagements", sa.Integer(), nullable=True),
    sa.Column("clicks", sa.Integer(), nullable=True),
    sa.Column("inquiries", sa.Integer(), nullable=True),
    sa.Column("raw_json", sa.Text(), nullable=True),
    *_timestamps(),
)
