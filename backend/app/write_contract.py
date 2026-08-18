import json
import re
from typing import Any

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


WRITE_FIELDS: dict[str, frozenset[str]] = {
    "tasks": frozenset({
        "title", "department_id", "assigned_to_id", "owner_id", "project_id",
        "linked_guest_note_id", "linked_fix_id", "linked_post_id", "due_date",
        "status", "priority", "note",
    }),
    "projects": frozenset({
        "title", "department_id", "owner_id", "start_date", "due_date",
        "status", "priority", "note",
    }),
    "requests": frozenset({
        "title", "department_id", "requested_by_id", "assigned_to_id", "request_type",
        "urgency", "status", "reason", "decision", "linked_task_id", "linked_project_id",
        "external_accounting_ref", "note",
    }),
    "shift-notes": frozenset({
        "title", "shift", "category", "department_id", "submitted_by_id", "urgency",
        "status", "note", "linked_task_id", "linked_guest_note_id", "linked_fix_id",
        "seen_by_id", "seen_at",
    }),
    "guests": frozenset({
        "title", "department_id", "room_area_id", "guest_name", "issue_type", "urgency",
        "status", "assigned_to_id", "action_taken", "follow_up_date", "note",
        "linked_task_id", "linked_fix_id",
    }),
    "fixes": frozenset({
        "title", "department_id", "room_area_id", "problem", "urgency", "status",
        "assigned_to_id", "reported_by_id", "verified_by_id", "verified_at", "note",
        "linked_guest_note_id", "linked_task_id",
    }),
    "posts": frozenset({
        "title", "department_id", "platform", "post_date", "content_type", "assigned_to_id",
        "project_id", "campaign", "status", "caption", "final_url", "results_json", "note",
    }),
}

REQUIRED_CREATE_FIELDS: dict[str, tuple[str, ...]] = {
    resource: ("title",) for resource in WRITE_FIELDS
}

ALLOWED_STATUSES: dict[str, frozenset[str]] = {
    "tasks": frozenset({"To Do", "Doing", "Review", "Done"}),
    "projects": frozenset({"Planned", "Active", "Paused", "Done"}),
    # These sets still constrain create/PATCH payload validation. Their generic
    # /status routes are workflow-owned and must reach the route-level 405 guard.
    "requests": frozenset({"Draft", "Review", "Planned", "Done"}),
    "shift-notes": frozenset({"New", "Seen", "Follow", "Done"}),
    "guests": frozenset({"Open", "Follow", "Done"}),
    "fixes": frozenset({"Open", "Working", "Done"}),
    "posts": frozenset({"Idea", "Draft", "Review", "Fix", "OK", "Set", "Posted"}),
}

WORKFLOW_STATUS_RESOURCES = frozenset({"requests", "fixes"})

_COLLECTION_RE = re.compile(r"^/api/([^/]+)$")
_ITEM_RE = re.compile(r"^/api/([^/]+)/(\d+)$")
_STATUS_RE = re.compile(r"^/api/([^/]+)/(\d+)/status$")


def _error(detail: str) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": detail})


def _json_object(raw: bytes) -> dict[str, Any] | None:
    try:
        value = json.loads(raw or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return value if isinstance(value, dict) else None


class WriteContractMiddleware(BaseHTTPMiddleware):
    """Reject unknown operational fields and invalid states before generic CRUD can persist them."""

    async def dispatch(self, request: Request, call_next):
        if request.method not in {"POST", "PATCH"}:
            return await call_next(request)
        if "application/json" not in request.headers.get("content-type", ""):
            return await call_next(request)

        path = request.url.path
        collection = _COLLECTION_RE.match(path)
        item = _ITEM_RE.match(path)
        status_route = _STATUS_RE.match(path)

        resource: str | None = None
        mode: str | None = None
        if request.method == "POST" and collection:
            resource, mode = collection.group(1), "create"
        elif request.method == "PATCH" and item:
            resource, mode = item.group(1), "update"
        elif request.method == "POST" and status_route:
            resource, mode = status_route.group(1), "status"

        if not resource or resource not in WRITE_FIELDS:
            return await call_next(request)

        # Request and Fix state changes are owned by canonical workflow commands.
        # Do not let value validation mask that API contract with a 422; the
        # generic route itself returns 405 for every attempted status mutation.
        if mode == "status" and resource in WORKFLOW_STATUS_RESOURCES:
            return await call_next(request)

        raw = await request.body()
        payload = _json_object(raw)
        if payload is None:
            return _error("Request body must be a JSON object.")

        if mode in {"create", "update"}:
            unknown = sorted(set(payload) - set(WRITE_FIELDS[resource]))
            if unknown:
                return _error(f"Unknown field(s) for {resource}: {', '.join(unknown)}")

            if mode == "create":
                for field in REQUIRED_CREATE_FIELDS.get(resource, ()):
                    value = payload.get(field)
                    if value is None or (isinstance(value, str) and not value.strip()):
                        return _error(f"{field.replace('_', ' ').title()} is required.")

            if "status" in payload:
                allowed = ALLOWED_STATUSES.get(resource)
                if allowed and payload["status"] not in allowed:
                    if resource == "requests" and payload["status"] in {"Approved", "Rejected"}:
                        return _error("Request decisions must use the linked Approval workflow.")
                    return _error(
                        f"Invalid status for {resource}. Allowed: {', '.join(sorted(allowed))}"
                    )

        elif mode == "status":
            status = payload.get("status")
            allowed = ALLOWED_STATUSES.get(resource)
            if allowed and status not in allowed:
                return _error(
                    f"Invalid status for {resource}. Allowed: {', '.join(sorted(allowed))}"
                )

        return await call_next(request)
