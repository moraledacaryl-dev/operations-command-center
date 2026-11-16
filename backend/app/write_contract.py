import json
import re
from typing import Any

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .domain_values import ALLOWED_STATUSES, WORKFLOW_RESOURCES
from .schemas.resources import RESOURCE_CREATE_SCHEMAS


# Keep historical protected fields at the boundary so downstream authorization
# continues to reject them with the same behavior as existing installations.
_PROTECTED_COMPATIBILITY_FIELDS: dict[str, frozenset[str]] = {
    "requests": frozenset({"decision", "requested_by_id"}),
    "shift-notes": frozenset({"seen_at", "seen_by_id", "submitted_by_id"}),
    "fixes": frozenset({"reported_by_id", "verified_at", "verified_by_id"}),
}
_CONTRACT_RESOURCES = ("tasks", "projects", "requests", "shift-notes", "guests", "fixes", "posts")
WRITE_FIELDS: dict[str, frozenset[str]] = {
    resource: frozenset(RESOURCE_CREATE_SCHEMAS[resource].model_fields)
        | _PROTECTED_COMPATIBILITY_FIELDS.get(resource, frozenset())
    for resource in _CONTRACT_RESOURCES
}

REQUIRED_CREATE_FIELDS: dict[str, tuple[str, ...]] = {
    resource: ("title",) for resource in WRITE_FIELDS
}

WORKFLOW_STATUS_RESOURCES = WORKFLOW_RESOURCES

_COLLECTION_RE = re.compile(r"^/api/([^/]+)$")
_ITEM_RE = re.compile(r"^/api/([^/]+)/(\d+)$")
_STATUS_RE = re.compile(r"^/api/([^/]+)/(\d+)/status$")


def _error(detail: str, status_code: int = 422) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail})


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

        # Stateful resource changes are owned by canonical workflow commands.
        if mode == "status" and resource in WORKFLOW_STATUS_RESOURCES:
            return _error("Use the canonical workflow endpoint.", status_code=405)

        raw = await request.body()
        payload = _json_object(raw)
        if payload is None:
            return _error("Request body must be a JSON object.")

        if mode in {"create", "update"}:
            unknown = sorted(set(payload) - set(WRITE_FIELDS[resource]) - {"expected_updated_at"})
            if unknown:
                return _error(f"Unknown field(s) for {resource}: {', '.join(unknown)}")

            if mode == "create":
                for field in REQUIRED_CREATE_FIELDS.get(resource, ()):
                    value = payload.get(field)
                    if value is None or (isinstance(value, str) and not value.strip()):
                        return _error(f"{field.replace('_', ' ').title()} is required.")

            if mode == "update" and resource in WORKFLOW_STATUS_RESOURCES and "status" in payload:
                return _error("Use the canonical workflow endpoint.", status_code=405)

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
