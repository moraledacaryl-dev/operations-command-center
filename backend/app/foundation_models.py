from sqlalchemy import Boolean, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from .clock import UTCDateTime as DateTime, utc_now
from .database import Base


class FoundationTimestampMixin:
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)


class Notification(Base, FoundationTimestampMixin):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kind = Column(String(80), nullable=False)
    title = Column(String(180), nullable=False)
    body = Column(Text, nullable=True)
    source_type = Column(String(80), nullable=True)
    source_id = Column(String(120), nullable=True)
    action_url = Column(Text, nullable=True)
    read_at = Column(DateTime, nullable=True)
    dismissed_at = Column(DateTime, nullable=True)
    priority = Column(String(20), default="Normal", nullable=False)
    metadata_json = Column(Text, nullable=True)
    __table_args__ = (Index("ix_notifications_user_unread", "user_id", "read_at"),)


class InboxItem(Base, FoundationTimestampMixin):
    __tablename__ = "inbox_items"
    id = Column(Integer, primary_key=True)
    source_app = Column(String(80), nullable=False)
    source_type = Column(String(80), nullable=False)
    source_id = Column(String(160), nullable=False)
    event_key = Column(String(180), nullable=True)
    title = Column(String(180), nullable=False)
    summary = Column(Text, nullable=True)
    category = Column(String(60), nullable=False)
    priority = Column(String(20), default="Normal", nullable=False)
    status = Column(String(40), default="Open", nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    due_at = Column(DateTime, nullable=True)
    seen_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    snoozed_until = Column(DateTime, nullable=True)
    action_url = Column(Text, nullable=True)
    payload_json = Column(Text, nullable=True)
    __table_args__ = (
        UniqueConstraint("source_app", "source_type", "source_id", "event_key", name="uq_inbox_source_event"),
        Index("ix_inbox_status_priority_due", "status", "priority", "due_at"),
    )


class ActivityEvent(Base):
    __tablename__ = "activity_events"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    entity_type = Column(String(80), nullable=False)
    entity_id = Column(String(120), nullable=False)
    event_type = Column(String(100), nullable=False)
    summary = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    occurred_at = Column(DateTime, default=utc_now, nullable=False)
    __table_args__ = (Index("ix_activity_entity_time", "entity_type", "entity_id", "occurred_at"),)


class RecordRelationship(Base, FoundationTimestampMixin):
    __tablename__ = "record_relationships"
    id = Column(Integer, primary_key=True)
    from_type = Column(String(80), nullable=False)
    from_id = Column(String(120), nullable=False)
    to_type = Column(String(80), nullable=False)
    to_id = Column(String(120), nullable=False)
    relationship_type = Column(String(80), nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    __table_args__ = (
        UniqueConstraint("from_type", "from_id", "to_type", "to_id", "relationship_type", name="uq_record_relationship"),
        Index("ix_record_relationship_from", "from_type", "from_id"),
        Index("ix_record_relationship_to", "to_type", "to_id"),
    )


class SavedView(Base, FoundationTimestampMixin):
    __tablename__ = "saved_views"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    workspace = Column(String(80), nullable=False)
    name = Column(String(120), nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)
    definition_json = Column(Text, nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "workspace", "name", name="uq_saved_view_user_workspace_name"),)


class UserPreference(Base, FoundationTimestampMixin):
    __tablename__ = "user_preferences"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    preference_key = Column(String(120), nullable=False)
    value_json = Column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("user_id", "preference_key", name="uq_user_preference_key"),)


class Mention(Base, FoundationTimestampMixin):
    __tablename__ = "mentions"
    id = Column(Integer, primary_key=True)
    mentioned_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    mentioned_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    parent_type = Column(String(80), nullable=False)
    parent_id = Column(String(120), nullable=False)
    body = Column(Text, nullable=True)
    read_at = Column(DateTime, nullable=True)


class Assignment(Base, FoundationTimestampMixin):
    __tablename__ = "assignments"
    id = Column(Integer, primary_key=True)
    entity_type = Column(String(80), nullable=False)
    entity_id = Column(String(120), nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    role = Column(String(60), default="Owner", nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    __table_args__ = (Index("ix_assignments_entity_active", "entity_type", "entity_id", "active"),)


class Annotation(Base, FoundationTimestampMixin):
    __tablename__ = "annotations"
    id = Column(Integer, primary_key=True)
    asset_version_id = Column(Integer, ForeignKey("asset_versions.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    annotation_type = Column(String(40), default="Pin", nullable=False)
    x_ratio = Column(String(32), nullable=True)
    y_ratio = Column(String(32), nullable=True)
    drawing_json = Column(Text, nullable=True)
    body = Column(Text, nullable=False)
    status = Column(String(40), default="Open", nullable=False)
    resolved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)


class AnnotationReply(Base, FoundationTimestampMixin):
    __tablename__ = "annotation_replies"
    id = Column(Integer, primary_key=True)
    annotation_id = Column(Integer, ForeignKey("annotations.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    body = Column(Text, nullable=False)


class IntegrationEventInbox(Base):
    __tablename__ = "integration_event_inbox"
    id = Column(Integer, primary_key=True)
    source_app = Column(String(80), nullable=False)
    external_event_id = Column(String(180), nullable=False)
    event_type = Column(String(120), nullable=False)
    payload_json = Column(Text, nullable=False)
    received_at = Column(DateTime, default=utc_now, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    attempts = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("source_app", "external_event_id", name="uq_integration_inbox_event"),)


class IntegrationEventOutbox(Base):
    __tablename__ = "integration_event_outbox"
    id = Column(Integer, primary_key=True)
    target_app = Column(String(80), nullable=False)
    event_type = Column(String(120), nullable=False)
    aggregate_type = Column(String(80), nullable=False)
    aggregate_id = Column(String(120), nullable=False)
    payload_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    published_at = Column(DateTime, nullable=True)
    attempts = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    __table_args__ = (Index("ix_integration_outbox_pending", "published_at", "created_at"),)


class MarketingCampaign(Base, FoundationTimestampMixin):
    __tablename__ = "marketing_campaigns"
    id = Column(Integer, primary_key=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    name = Column(String(180), nullable=False)
    objective = Column(Text, nullable=True)
    status = Column(String(40), default="Planning", nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    start_at = Column(DateTime, nullable=True)
    end_at = Column(DateTime, nullable=True)
    budget_note = Column(Text, nullable=True)


class ContentConcept(Base, FoundationTimestampMixin):
    __tablename__ = "content_concepts"
    id = Column(Integer, primary_key=True)
    campaign_id = Column(Integer, ForeignKey("marketing_campaigns.id"), nullable=False)
    content_pillar = Column(String(80), default="General", nullable=False)
    title = Column(String(180), nullable=False)
    brief = Column(Text, nullable=True)
    status = Column(String(40), default="Idea", nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class PlatformDeliverable(Base, FoundationTimestampMixin):
    __tablename__ = "platform_deliverables"
    id = Column(Integer, primary_key=True)
    concept_id = Column(Integer, ForeignKey("content_concepts.id"), nullable=False)
    platform = Column(String(60), nullable=False)
    format = Column(String(60), nullable=False)
    dimensions = Column(String(60), nullable=True)
    caption = Column(Text, nullable=True)
    call_to_action = Column(Text, nullable=True)
    hashtags = Column(Text, nullable=True)
    status = Column(String(40), default="Planned", nullable=False)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    scheduled_at = Column(DateTime, nullable=True)
    final_url = Column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("concept_id", "platform", name="uq_deliverable_concept_platform"),)


class Asset(Base, FoundationTimestampMixin):
    __tablename__ = "assets"
    id = Column(Integer, primary_key=True)
    deliverable_id = Column(Integer, ForeignKey("platform_deliverables.id"), nullable=True)
    title = Column(String(180), nullable=False)
    asset_type = Column(String(60), nullable=False)
    status = Column(String(40), default="Active", nullable=False)
    current_version_id = Column(Integer, nullable=True)


class AssetVersion(Base, FoundationTimestampMixin):
    __tablename__ = "asset_versions"
    id = Column(Integer, primary_key=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    version_no = Column(Integer, nullable=False)
    filename = Column(String(220), nullable=False)
    storage_key = Column(Text, nullable=False)
    mime_type = Column(String(120), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    note = Column(Text, nullable=True)
    __table_args__ = (UniqueConstraint("asset_id", "version_no", name="uq_asset_version_number"),)


class PublishingRecord(Base, FoundationTimestampMixin):
    __tablename__ = "publishing_records"
    id = Column(Integer, primary_key=True)
    deliverable_id = Column(Integer, ForeignKey("platform_deliverables.id"), nullable=False)
    scheduled_at = Column(DateTime, nullable=True)
    published_at = Column(DateTime, nullable=True)
    status = Column(String(40), default="Queued", nullable=False)
    external_post_id = Column(String(180), nullable=True)
    published_url = Column(Text, nullable=True)
    failure_reason = Column(Text, nullable=True)


class PerformanceSnapshot(Base, FoundationTimestampMixin):
    __tablename__ = "performance_snapshots"
    id = Column(Integer, primary_key=True)
    deliverable_id = Column(Integer, ForeignKey("platform_deliverables.id"), nullable=False)
    captured_at = Column(DateTime, default=utc_now, nullable=False)
    reach = Column(Integer, nullable=True)
    impressions = Column(Integer, nullable=True)
    engagements = Column(Integer, nullable=True)
    clicks = Column(Integer, nullable=True)
    inquiries = Column(Integer, nullable=True)
    raw_json = Column(Text, nullable=True)
