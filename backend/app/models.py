from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from .database import Base


def utcnow():
    return datetime.utcnow()


class TimestampMixin:
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class ArchiveMixin:
    completed_at = Column(DateTime, nullable=True)
    archived_at = Column(DateTime, nullable=True)
    hidden_from_active = Column(Boolean, default=False, nullable=False)
    archive_reason = Column(String(120), nullable=True)


class Department(Base, TimestampMixin):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), unique=True, nullable=False)
    short_name = Column(String(40), nullable=True)
    users = relationship("User", back_populates="department")
    memberships = relationship("UserDepartment", back_populates="department", cascade="all, delete-orphan")


class UserDepartment(Base, TimestampMixin):
    __tablename__ = "user_departments"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    is_primary = Column(Boolean, default=False, nullable=False)
    role_override = Column(String(40), nullable=True)
    user = relationship("User", back_populates="department_memberships")
    department = relationship("Department", back_populates="memberships")


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    email = Column(String(160), unique=True, nullable=True)
    role = Column(String(40), default="manager", nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    department = relationship("Department", back_populates="users")
    department_memberships = relationship("UserDepartment", back_populates="user", cascade="all, delete-orphan")


class RoomArea(Base, TimestampMixin):
    __tablename__ = "rooms_areas"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False)
    kind = Column(String(20), default="room", nullable=False)  # room or area
    status = Column(String(40), default="active", nullable=False)
    note = Column(Text, nullable=True)


class Project(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    start_date = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(40), default="Planned", nullable=False)  # Planned, Active, Paused, Done
    priority = Column(String(20), default="Normal", nullable=False)
    note = Column(Text, nullable=True)


class Task(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    linked_guest_note_id = Column(Integer, ForeignKey("guest_notes.id"), nullable=True)
    linked_fix_id = Column(Integer, ForeignKey("fixes.id"), nullable=True)
    linked_post_id = Column(Integer, ForeignKey("posts.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(40), default="To Do", nullable=False)  # To Do, Doing, Review, Done
    priority = Column(String(20), default="Normal", nullable=False)
    note = Column(Text, nullable=True)


class ShiftNote(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "shift_notes"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    shift = Column(String(40), nullable=True)  # AM, PM, Night
    category = Column(String(40), nullable=True)  # Guest, Room, Fix, Supply, Payment, Event, Staff, Other
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    submitted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    urgency = Column(String(20), default="Normal", nullable=False)
    status = Column(String(40), default="New", nullable=False)  # New, Seen, Follow, Done
    note = Column(Text, nullable=True)
    linked_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    linked_guest_note_id = Column(Integer, ForeignKey("guest_notes.id"), nullable=True)
    linked_fix_id = Column(Integer, ForeignKey("fixes.id"), nullable=True)
    seen_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    seen_at = Column(DateTime, nullable=True)


class GuestNote(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "guest_notes"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    room_area_id = Column(Integer, ForeignKey("rooms_areas.id"), nullable=True)
    guest_name = Column(String(120), nullable=True)
    issue_type = Column(String(40), nullable=True)  # AC, Towel, WiFi, Noise, etc.
    urgency = Column(String(20), default="Normal", nullable=False)
    status = Column(String(40), default="Open", nullable=False)  # Open, Follow, Done
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action_taken = Column(Text, nullable=True)
    follow_up_date = Column(DateTime, nullable=True)
    note = Column(Text, nullable=True)
    linked_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    linked_fix_id = Column(Integer, ForeignKey("fixes.id"), nullable=True)


class Fix(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "fixes"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    room_area_id = Column(Integer, ForeignKey("rooms_areas.id"), nullable=True)
    problem = Column(Text, nullable=True)
    urgency = Column(String(20), default="Normal", nullable=False)
    status = Column(String(40), default="Open", nullable=False)  # Open, Working, Done, Verified
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reported_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=True)
    linked_guest_note_id = Column(Integer, ForeignKey("guest_notes.id"), nullable=True)
    linked_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)


class Post(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    platform = Column(String(40), nullable=True)
    post_date = Column(DateTime, nullable=True)
    content_type = Column(String(40), nullable=True)  # Reel, Story, Static, Carousel, Ad, Blog
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    campaign = Column(String(120), nullable=True)
    status = Column(String(40), default="Idea", nullable=False)  # Idea, Draft, Review, Fix, OK, Set, Posted
    caption = Column(Text, nullable=True)
    final_url = Column(Text, nullable=True)
    results_json = Column(Text, nullable=True)
    note = Column(Text, nullable=True)


class PostVersion(Base, TimestampMixin):
    __tablename__ = "post_versions"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False)
    version_no = Column(Integer, nullable=False)
    filename = Column(String(220), nullable=True)
    file_url = Column(Text, nullable=True)
    caption_snapshot = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_current = Column(Boolean, default=True, nullable=False)


class Approval(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "approvals"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    source_type = Column(String(40), nullable=True)  # post, task, guest, fix, memo, project, ops_need
    source_id = Column(Integer, nullable=True)
    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    status = Column(String(40), default="Pending", nullable=False)  # Pending, Approved, Rejected
    priority = Column(String(20), default="Normal", nullable=False)
    decision_note = Column(Text, nullable=True)
    decided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=True)


class Memo(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "memos"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    message = Column(Text, nullable=True)
    status = Column(String(40), default="Open", nullable=False)
    expiry_date = Column(DateTime, nullable=True)
    must_ack = Column(Boolean, default=False, nullable=False)


class Submission(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "submissions"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    source_app = Column(String(40), default="command_center", nullable=False)
    source_type = Column(String(40), nullable=True)  # task_update, shift_note, guest_note, fix_report, post_upload
    submitted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at = Column(DateTime, default=utcnow, nullable=False)
    requires_review = Column(Boolean, default=True, nullable=False)
    review_status = Column(String(40), default="New", nullable=False)  # New, Review, Accepted, Rejected, Archived
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    payload_json = Column(Text, nullable=True)
    linked_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    linked_guest_note_id = Column(Integer, ForeignKey("guest_notes.id"), nullable=True)
    linked_fix_id = Column(Integer, ForeignKey("fixes.id"), nullable=True)
    linked_post_id = Column(Integer, ForeignKey("posts.id"), nullable=True)
    linked_room_area_id = Column(Integer, ForeignKey("rooms_areas.id"), nullable=True)
    note = Column(Text, nullable=True)


class Request(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "requests"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    request_type = Column(String(60), default="General", nullable=False)  # Equipment, Policy, Process, Staffing, Supply, Marketing, Maintenance, Event, Other
    urgency = Column(String(20), default="Normal", nullable=False)
    status = Column(String(40), default="Draft", nullable=False)  # Draft, Review, Approved, Rejected, Planned, Done
    reason = Column(Text, nullable=True)
    decision = Column(Text, nullable=True)
    linked_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    linked_project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    external_accounting_ref = Column(String(180), nullable=True)
    note = Column(Text, nullable=True)


class TalkMessage(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "talk_messages"
    id = Column(Integer, primary_key=True)
    parent_type = Column(String(40), default="department", nullable=False)
    parent_id = Column(Integer, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    message_type = Column(String(40), default="Update", nullable=False)  # Update, Ask, Follow, Decision, File
    body = Column(Text, nullable=False)
    status = Column(String(40), default="Open", nullable=False)


class DepartmentDoc(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "department_docs"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    doc_type = Column(String(40), default="SOP", nullable=False)
    body = Column(Text, nullable=True)
    status = Column(String(40), default="Active", nullable=False)


class RoutineTemplate(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "routine_templates"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    frequency = Column(String(40), default="Weekly", nullable=False)
    checklist = Column(Text, nullable=True)
    status = Column(String(40), default="Active", nullable=False)
    priority = Column(String(20), default="Normal", nullable=False)
    last_generated_at = Column(DateTime, nullable=True)


class Comment(Base, TimestampMixin):
    __tablename__ = "comments"
    id = Column(Integer, primary_key=True)
    parent_type = Column(String(40), nullable=False)
    parent_id = Column(Integer, nullable=False)
    comment_type = Column(String(40), default="General", nullable=False)
    body = Column(Text, nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class Attachment(Base, TimestampMixin):
    __tablename__ = "attachments"
    id = Column(Integer, primary_key=True)
    parent_type = Column(String(40), nullable=False)
    parent_id = Column(Integer, nullable=False)
    filename = Column(String(220), nullable=False)
    file_url = Column(Text, nullable=True)
    mime_type = Column(String(120), nullable=True)
    version_no = Column(Integer, nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(Integer, nullable=False)
    action = Column(String(80), nullable=False)
    message = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
