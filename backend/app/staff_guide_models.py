"""Controlled staff-guide content, independent of historical department_docs.

Published revisions are immutable snapshots. The document row contains the
editable working copy and a pointer to the current published snapshot.
"""
from sqlalchemy import Boolean, Column, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from .clock import UTCDateTime as DateTime, utc_now
from .database import Base


class GuideDocument(Base):
    __tablename__ = "guide_documents"
    id = Column(Integer, primary_key=True)
    title = Column(String(180), nullable=False)
    doc_type = Column(String(30), nullable=False, default="Quick Guide")
    category = Column(String(80), nullable=False, default="General")
    summary = Column(Text, nullable=False, default="")
    body = Column(Text, nullable=False, default="")
    audience = Column(String(24), nullable=False, default="departments")
    department_ids = Column(JSON, nullable=False, default=list)
    requires_ack = Column(Boolean, nullable=False, default=False)
    status = Column(String(24), nullable=False, default="Draft")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    current_revision_id = Column(Integer, nullable=True)
    version = Column(Integer, nullable=False, default=0)
    effective_at = Column(DateTime, nullable=True)
    review_at = Column(DateTime, nullable=True)
    retired_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    __table_args__ = (Index("ix_guide_documents_current", "current_revision_id"),)


class GuideRevision(Base):
    __tablename__ = "guide_revisions"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("guide_documents.id"), nullable=False)
    version = Column(Integer, nullable=False)
    title = Column(String(180), nullable=False)
    doc_type = Column(String(30), nullable=False)
    category = Column(String(80), nullable=False)
    summary = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    audience = Column(String(24), nullable=False)
    requires_ack = Column(Boolean, nullable=False)
    effective_at = Column(DateTime, nullable=True)
    published_at = Column(DateTime, default=utc_now, nullable=False)
    published_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    __table_args__ = (UniqueConstraint("document_id", "version", name="uq_guide_document_version"),)


class GuideRevisionDepartment(Base):
    __tablename__ = "guide_revision_departments"
    revision_id = Column(Integer, ForeignKey("guide_revisions.id"), primary_key=True)
    department_id = Column(Integer, ForeignKey("departments.id"), primary_key=True)


class GuideAcknowledgment(Base):
    __tablename__ = "guide_acknowledgments"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    revision_id = Column(Integer, ForeignKey("guide_revisions.id"), nullable=False)
    acknowledged_at = Column(DateTime, default=utc_now, nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "revision_id", name="uq_guide_ack_user_revision"),)


class GuideReading(Base):
    __tablename__ = "guide_readings"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    revision_id = Column(Integer, ForeignKey("guide_revisions.id"), nullable=False)
    assigned_at = Column(DateTime, default=utc_now, nullable=False)
    due_at = Column(DateTime, nullable=True)
    last_reminded_at = Column(DateTime, nullable=True)
    __table_args__ = (
        UniqueConstraint("user_id", "revision_id", name="uq_guide_reading_user_revision"),
        Index("ix_guide_reading_user_revision", "user_id", "revision_id"),
    )
