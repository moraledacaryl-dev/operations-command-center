from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, create_model

from ..domain_values import (
    ContentFormat,
    Platform,
    PostStatus,
    Priority,
    ProjectStatus,
    RoomKind,
    RoomStatus,
    ShiftStatus,
    TaskStatus,
    GuestStatus,
    WORKFLOW_RESOURCES,
)


class StrictResourcePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


NonEmpty = str
OptionalInt = int | None
OptionalStr = str | None
OptionalBool = bool | None
OptionalDateTime = datetime | None


def _required_text(max_length: int):
    return (str, Field(..., min_length=1, max_length=max_length))


def _optional_text(max_length: int):
    return (str | None, Field(default=None, max_length=max_length))


def _optional_int():
    return (int | None, None)


def _optional_bool(default: bool | None = None):
    return (bool | None, default)


def _optional_datetime():
    return (datetime | None, None)


def _schema(name: str, fields: dict[str, tuple[Any, Any]]):
    return create_model(name, __base__=StrictResourcePayload, **fields)


RESOURCE_CREATE_SCHEMAS = {
    "departments": _schema("DepartmentCreatePayload", {
        "name": _required_text(80),
        "short_name": _optional_text(40),
    }),
    "user-departments": _schema("UserDepartmentCreatePayload", {
        "user_id": (int, Field(..., ge=1)),
        "department_id": (int, Field(..., ge=1)),
        "is_primary": (bool, False),
        "role_override": _optional_text(40),
    }),
    "rooms": _schema("RoomCreatePayload", {
        "name": _required_text(80),
        "kind": (RoomKind, RoomKind.ROOM),
        "status": (RoomStatus, RoomStatus.ACTIVE),
        "note": (str | None, None),
    }),
    "requests": _schema("RequestCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "assigned_to_id": _optional_int(),
        "request_type": (str, Field(default="General", min_length=1, max_length=60)),
        "urgency": (Priority, Priority.NORMAL),
        "status": (Literal["Draft"] | None, None),
        "reason": (str | None, None),
        "linked_task_id": _optional_int(),
        "linked_project_id": _optional_int(),
        "external_accounting_ref": _optional_text(180),
        "note": (str | None, None),
    }),
    "talk": _schema("TalkCreatePayload", {
        "parent_type": (str, Field(default="department", min_length=1, max_length=40)),
        "parent_id": (int, Field(..., ge=1)),
        "department_id": _optional_int(),
        "message_type": (str, Field(default="Update", min_length=1, max_length=40)),
        "body": _required_text(10000),
        "status": (str, Field(default="Open", min_length=1, max_length=40)),
    }),
    "docs": _schema("DepartmentDocCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "doc_type": (str, Field(default="SOP", min_length=1, max_length=40)),
        "body": (str | None, None),
        "status": (str, Field(default="Active", min_length=1, max_length=40)),
    }),
    "routines": _schema("RoutineCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "assigned_to_id": _optional_int(),
        "frequency": (str, Field(default="Weekly", min_length=1, max_length=40)),
        "checklist": (str | None, None),
        "status": (str, Field(default="Active", min_length=1, max_length=40)),
        "priority": (Priority, Priority.NORMAL),
        "last_generated_at": _optional_datetime(),
    }),
    "projects": _schema("ProjectCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "owner_id": _optional_int(),
        "start_date": _optional_datetime(),
        "due_date": _optional_datetime(),
        "status": (Literal["Planned"], "Planned"),
        "priority": (Priority, Priority.NORMAL),
        "note": (str | None, None),
    }),
    "tasks": _schema("TaskCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "assigned_to_id": _optional_int(),
        "owner_id": _optional_int(),
        "project_id": _optional_int(),
        "linked_guest_note_id": _optional_int(),
        "linked_fix_id": _optional_int(),
        "linked_post_id": _optional_int(),
        "due_date": _optional_datetime(),
        "status": (Literal["To Do"], "To Do"),
        "priority": (Priority, Priority.NORMAL),
        "note": (str | None, None),
    }),
    "shift-notes": _schema("ShiftNoteCreatePayload", {
        "title": _required_text(180),
        "shift": _optional_text(40),
        "category": _optional_text(40),
        "department_id": _optional_int(),
        "urgency": (Priority, Priority.NORMAL),
        "status": (Literal["New"], "New"),
        "note": (str | None, None),
        "linked_task_id": _optional_int(),
        "linked_guest_note_id": _optional_int(),
        "linked_fix_id": _optional_int(),
    }),
    "guests": _schema("GuestNoteCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "room_area_id": _optional_int(),
        "guest_name": _optional_text(120),
        "issue_type": _optional_text(40),
        "urgency": (Priority, Priority.NORMAL),
        "status": (Literal["Open"], "Open"),
        "assigned_to_id": _optional_int(),
        "action_taken": (str | None, None),
        "follow_up_date": _optional_datetime(),
        "note": (str | None, None),
        "linked_task_id": _optional_int(),
        "linked_fix_id": _optional_int(),
    }),
    "fixes": _schema("FixCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "room_area_id": _optional_int(),
        "problem": (str | None, None),
        "urgency": (Priority, Priority.NORMAL),
        "status": (Literal["Open"] | None, None),
        "assigned_to_id": _optional_int(),
        "note": (str | None, None),
        "linked_guest_note_id": _optional_int(),
        "linked_task_id": _optional_int(),
    }),
    "posts": _schema("PostCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "platform": (Platform | None, None),
        "post_date": _optional_datetime(),
        "content_type": (ContentFormat | None, None),
        "assigned_to_id": _optional_int(),
        "project_id": _optional_int(),
        "campaign": _optional_text(120),
        "status": (Literal["Idea"], "Idea"),
        "caption": (str | None, None),
        "final_url": (str | None, None),
        "results_json": (str | None, None),
        "note": (str | None, None),
    }),
    "approvals": _schema("ApprovalCreatePayload", {
        "title": _required_text(180),
        "source_type": _optional_text(40),
        "source_id": _optional_int(),
        "department_id": _optional_int(),
        "status": _optional_text(40),
        "priority": (Priority, Priority.NORMAL),
        "decision_note": (str | None, None),
        "note": (str | None, None),
    }),
    "memos": _schema("MemoCreatePayload", {
        "title": _required_text(180),
        "department_id": _optional_int(),
        "message": (str | None, None),
        "status": (str, Field(default="Open", min_length=1, max_length=40)),
        "expiry_date": _optional_datetime(),
        "must_ack": (bool, False),
    }),
    "submissions": _schema("SubmissionCreatePayload", {
        "title": _required_text(180),
        "source_app": (str, Field(default="command_center", min_length=1, max_length=40)),
        "source_type": _optional_text(40),
        "department_id": _optional_int(),
        "submitted_at": _optional_datetime(),
        "requires_review": (bool, True),
        "review_status": (str, Field(default="New", min_length=1, max_length=40)),
        "payload_json": (str | None, None),
        "linked_task_id": _optional_int(),
        "linked_guest_note_id": _optional_int(),
        "linked_fix_id": _optional_int(),
        "linked_post_id": _optional_int(),
        "linked_room_area_id": _optional_int(),
        "note": (str | None, None),
    }),
    "external-review-items": _schema("ExternalReviewItemCreatePayload", {
        "external_source": _required_text(80),
        "external_id": _required_text(200),
        "event_type": _required_text(120),
        "source_app": _required_text(80),
        "source_record_type": _optional_text(120),
        "source_record_id": _optional_text(120),
        "department_id": _optional_int(),
        "title": _required_text(180),
        "summary": (str | None, None),
        "priority": (Priority, Priority.NORMAL),
        "status": (str, Field(default="For Review", min_length=1, max_length=40)),
        "payload_json": (str | None, None),
        "linked_task_id": _optional_int(),
        "linked_approval_id": _optional_int(),
    }),
}

# Users are intentionally excluded from generic CRUD; account creation is handled
# by the explicit /api/admin/users contract.


def _patch_schema(resource: str, create_schema: type[BaseModel]) -> type[BaseModel]:
    fields: dict[str, tuple[Any, Any]] = {}
    for name, field in create_schema.model_fields.items():
        if resource in WORKFLOW_RESOURCES and name == "status":
            continue
        annotation = field.annotation
        if annotation is not None and type(None) not in getattr(annotation, "__args__", ()):
            annotation = annotation | None
        fields[name] = (annotation or Any, None)
    return _schema(f"{create_schema.__name__.removesuffix('CreatePayload')}PatchPayload", fields)


RESOURCE_PATCH_SCHEMAS = {
    resource: _patch_schema(resource, schema)
    for resource, schema in RESOURCE_CREATE_SCHEMAS.items()
}


def validate_resource_payload(resource: str, payload: dict[str, Any], *, patch: bool = False) -> dict[str, Any]:
    registry = RESOURCE_PATCH_SCHEMAS if patch else RESOURCE_CREATE_SCHEMAS
    schema = registry.get(resource)
    if schema is None:
        raise KeyError(resource)
    validated = schema.model_validate(payload)
    return validated.model_dump(exclude_unset=True, mode="json")


__all__ = [
    "RESOURCE_CREATE_SCHEMAS",
    "RESOURCE_PATCH_SCHEMAS",
    "ValidationError",
    "validate_resource_payload",
]
