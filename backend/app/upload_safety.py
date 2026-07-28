from __future__ import annotations

import re
from pathlib import PurePath
from urllib.parse import unquote, urlparse

from starlette.responses import JSONResponse


WRITE_METHODS = {"POST", "PUT", "PATCH"}
UPLOAD_PATH_MARKERS = ("/attachments", "/versions")
BLOCKED_EXTENSIONS = {
    ".app", ".bat", ".bin", ".cmd", ".com", ".cpl", ".dll", ".dmg", ".exe",
    ".hta", ".htm", ".html", ".jar", ".js", ".jse", ".lnk", ".mjs", ".msi",
    ".php", ".ps1", ".py", ".reg", ".scr", ".sh", ".svg", ".vbs", ".wsf",
}
ALLOWED_EXTERNAL_SCHEMES = {"http", "https"}
MAX_FILENAME_LENGTH = 180


def _unsafe_filename(filename: str) -> str | None:
    value = unquote((filename or "").strip())
    if not value:
        return None
    if len(value) > MAX_FILENAME_LENGTH:
        return "Filename is too long."
    if "\x00" in value or any(ord(ch) < 32 for ch in value):
        return "Filename contains invalid control characters."
    name = PurePath(value.replace("\\", "/")).name
    if name != value.replace("\\", "/").split("/")[-1]:
        return "Filename contains an invalid path."
    suffixes = [suffix.lower() for suffix in PurePath(name).suffixes]
    blocked = next((suffix for suffix in suffixes if suffix in BLOCKED_EXTENSIONS), None)
    if blocked:
        return f"File type '{blocked}' is not allowed."
    return None


def _multipart_filenames(body: bytes) -> list[str]:
    text = body.decode("latin-1", errors="ignore")
    return re.findall(r'filename="([^"]*)"', text, flags=re.IGNORECASE)


def _unsafe_external_url(body: bytes) -> str | None:
    text = body.decode("latin-1", errors="ignore")
    matches = re.findall(
        r'name="file_url"\r?\n(?:[^\r\n]*\r?\n)*\r?\n([^\r\n]*)',
        text,
        flags=re.IGNORECASE,
    )
    for value in matches:
        candidate = value.strip()
        if not candidate or candidate.startswith("/uploads/"):
            continue
        parsed = urlparse(candidate)
        if parsed.scheme.lower() not in ALLOWED_EXTERNAL_SCHEMES or not parsed.netloc:
            return "Attachment URLs must use an absolute HTTP or HTTPS URL."
    return None


class UploadSafetyMiddleware:
    """Reject dangerous attachment names and unsafe externally supplied URLs."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        path = scope.get("path", "")
        if method not in WRITE_METHODS or not any(marker in path for marker in UPLOAD_PATH_MARKERS):
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        content_type = headers.get("content-type", "").lower()
        if "multipart/form-data" not in content_type:
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        more_body = True
        while more_body:
            message = await receive()
            if message.get("type") != "http.request":
                continue
            chunks.append(message.get("body", b""))
            more_body = bool(message.get("more_body", False))
        body = b"".join(chunks)

        error = None
        for filename in _multipart_filenames(body):
            error = _unsafe_filename(filename)
            if error:
                break
        error = error or _unsafe_external_url(body)
        if error:
            response = JSONResponse(status_code=400, content={"detail": error})
            await response(scope, receive, send)
            return

        delivered = False

        async def replay_receive():
            nonlocal delivered
            if delivered:
                return {"type": "http.request", "body": b"", "more_body": False}
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay_receive, send)
