from __future__ import annotations

import os
import uuid

from fastapi import Request
from starlette.responses import JSONResponse


MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(12 * 1024 * 1024)))


def request_id(request: Request) -> str:
    incoming = (request.headers.get("X-Request-Id") or "").strip()
    if incoming and len(incoming) <= 128 and all(ch.isalnum() or ch in "-_.:" for ch in incoming):
        return incoming
    return uuid.uuid4().hex


async def enforce_request_boundary(request: Request):
    if request.method in {"POST", "PUT", "PATCH"}:
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                if int(raw_length) > MAX_REQUEST_BYTES:
                    return JSONResponse(status_code=413, content={"detail": "Request body is too large."})
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header."})

    return None
