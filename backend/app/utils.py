import json
from datetime import datetime
from typing import Any, Dict, Iterable, Optional
from sqlalchemy import DateTime, inspect
from . import models

SENSITIVE_MODEL_FIELDS = {"password_hash"}


def parse_datetime(value: Any) -> Any:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized).replace(tzinfo=None)
        except ValueError:
            # Accept YYYY-MM-DD from date inputs.
            try:
                return datetime.fromisoformat(value + "T00:00:00")
            except ValueError:
                return value
    return value


def model_to_dict(obj: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for column in inspect(obj.__class__).columns:
        if column.key in SENSITIVE_MODEL_FIELDS:
            continue
        value = getattr(obj, column.key)
        if isinstance(value, datetime):
            out[column.key] = value.isoformat()
        else:
            out[column.key] = value
    return out


def serialize_many(items: Iterable[Any]):
    return [model_to_dict(item) for item in items]


def apply_payload(obj: Any, payload: Dict[str, Any], excluded: Optional[set] = None):
    excluded = excluded or {"id", "created_at", "updated_at"}
    columns = {c.key: c for c in inspect(obj.__class__).columns}
    for key, value in payload.items():
        if key in excluded or key not in columns:
            continue
        column = columns[key]
        if isinstance(column.type, DateTime):
            value = parse_datetime(value)
        setattr(obj, key, value)
    return obj


def log_activity(db, entity_type: str, entity_id: int, action: str, message: str = "", actor_id: int | None = None, metadata: Dict[str, Any] | None = None):
    entry = models.ActivityLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        message=message,
        actor_id=actor_id,
        metadata_json=json.dumps(metadata or {}, default=str),
    )
    db.add(entry)
    return entry


def mark_completed_if_needed(obj: Any, status: str):
    done_statuses = {"Done", "Verified", "Posted", "Approved", "Rejected", "OK"}
    if status in done_statuses and hasattr(obj, "completed_at") and not getattr(obj, "completed_at", None):
        obj.completed_at = datetime.utcnow()
    if status not in done_statuses and hasattr(obj, "completed_at"):
        obj.completed_at = None
