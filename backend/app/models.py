from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base


def utcnow():
    """Return a naive UTC datetime for legacy DateTime columns without using deprecated utcnow()."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    password_hash = Column(String(255), nullable=True)
    password_set_at = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)
    role = Column(String(40), default="manager", nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    department = relationship("Department", back_populates="users")
    department_memberships = relationship("UserDepartment", back_populates="user", cascade="all, delete-orphan")


class RoomArea(Base, TimestampMixin):
    __tablename__ = "rooms_areas"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), nullable=False)
    kind = Column(String(20), default="room", nullable=False)
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
    status = Column(String(40), default="Planned", nullable=False)
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
    status = Column(String(40), default="To Do", nullable=False)
    priority = Column(String(20), default="Normal", nullable=False)
    note = Column(Text, nullable=True)


class ShiftNote(Base, TimestampMixin, ArchiveMixin):
    __tablename__ = "shift_notes"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    shift = Column(String(40), nullable=True)
    category = Column(String(40), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    submitted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    urgency = Column(String(20), default="Normal", nullable=False)
    status = Column(String(40), default="New", nullable=False)
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
