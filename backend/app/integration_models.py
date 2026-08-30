from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from .clock import UTCDateTime as DateTime, utc_now
from .database import Base


class ExternalUserIdentity(Base):
    """Maps an app-specific staff/user identifier to one Operations user.

    Operations remains the operational identity directory. Payroll/HR fields stay
    in the Staff/Payroll app; this table stores only the minimum linkage needed
    for assignments, submissions, approvals, and accountability.
    """

    __tablename__ = "external_user_identities"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    source_app = Column(String(80), nullable=False)
    external_user_id = Column(String(160), nullable=False)
    external_email = Column(String(160), nullable=True)
    external_name = Column(String(180), nullable=True)
    status = Column(String(40), default="active", nullable=False)
    first_seen_at = Column(DateTime, default=utc_now, nullable=False)
    last_seen_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("source_app", "external_user_id", name="uq_external_user_identity_source_id"),
        Index("ix_external_user_identity_user", "user_id", "source_app"),
    )


class IntegrationDelivery(Base):
    """Immutable delivery/audit record for versioned cross-app events."""

    __tablename__ = "integration_deliveries"

    id = Column(Integer, primary_key=True)
    source_app = Column(String(80), nullable=False)
    event_id = Column(String(180), nullable=False)
    event_type = Column(String(140), nullable=False)
    schema_version = Column(Integer, default=1, nullable=False)
    correlation_id = Column(String(180), nullable=True)
    subject_type = Column(String(100), nullable=True)
    subject_id = Column(String(180), nullable=True)
    status = Column(String(40), default="received", nullable=False)
    payload_sha256 = Column(String(64), nullable=False)
    received_at = Column(DateTime, default=utc_now, nullable=False)
    processed_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("source_app", "event_id", name="uq_integration_delivery_source_event"),
        Index("ix_integration_delivery_status_received", "status", "received_at"),
        Index("ix_integration_delivery_correlation", "correlation_id"),
    )
