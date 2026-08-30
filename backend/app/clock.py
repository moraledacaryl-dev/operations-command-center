from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime as SADateTime
from sqlalchemy.types import TypeDecorator


UTC = timezone.utc


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class UTCDateTime(TypeDecorator):
    """Persist UTC instants and return timezone-aware UTC values."""

    impl = SADateTime
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(SADateTime(timezone=dialect.name != "sqlite"))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        normalized = as_utc(value)
        return normalized.replace(tzinfo=None) if dialect.name == "sqlite" else normalized

    def process_result_value(self, value, dialect):
        return as_utc(value) if value is not None else None


__all__ = ["UTC", "UTCDateTime", "as_utc", "utc_now"]
