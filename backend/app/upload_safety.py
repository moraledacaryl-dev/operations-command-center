from __future__ import annotations

from pathlib import PurePath
from urllib.parse import unquote, urlparse


BLOCKED_EXTENSIONS = {
    ".app", ".bat", ".bin", ".cmd", ".com", ".cpl", ".dll", ".dmg", ".exe",
    ".hta", ".htm", ".html", ".jar", ".js", ".jse", ".lnk", ".mjs", ".msi",
    ".php", ".ps1", ".py", ".reg", ".scr", ".sh", ".svg", ".vbs", ".wsf",
}
ALLOWED_EXTERNAL_SCHEMES = {"http", "https"}
MAX_FILENAME_LENGTH = 180


def safe_original_filename(filename: str) -> str:
    value = unquote((filename or "").strip())
    if not value:
        raise ValueError("Filename is required.")
    if len(value) > MAX_FILENAME_LENGTH:
        raise ValueError("Filename is too long.")
    if "\x00" in value or any(ord(ch) < 32 for ch in value):
        raise ValueError("Filename contains invalid control characters.")

    normalized = value.replace("\\", "/")
    name = PurePath(normalized).name
    if not name or name in {".", ".."}:
        raise ValueError("Filename is invalid.")

    suffixes = [suffix.lower() for suffix in PurePath(name).suffixes]
    blocked = next((suffix for suffix in suffixes if suffix in BLOCKED_EXTENSIONS), None)
    if blocked:
        raise ValueError(f"File type '{blocked}' is not allowed.")
    return name


def validate_external_url(value: str) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    if candidate.startswith("/uploads/"):
        return candidate
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in ALLOWED_EXTERNAL_SCHEMES or not parsed.netloc:
        raise ValueError("Attachment URLs must use an absolute HTTP or HTTPS URL.")
    if parsed.username or parsed.password:
        raise ValueError("Attachment URLs must not contain embedded credentials.")
    return candidate
