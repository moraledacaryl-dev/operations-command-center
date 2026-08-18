from __future__ import annotations

from pathlib import PurePath
from urllib.parse import unquote, urlparse


BLOCKED_EXTENSIONS = {
    ".app", ".bat", ".bin", ".cmd", ".com", ".cpl", ".dll", ".dmg", ".exe",
    ".hta", ".htm", ".html", ".jar", ".js", ".jse", ".lnk", ".mjs", ".msi",
    ".php", ".ps1", ".py", ".reg", ".scr", ".sh", ".svg", ".vbs", ".wsf",
}
ALLOWED_UPLOAD_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".docx", ".xlsx", ".pptx", ".txt", ".csv", ".mp4", ".mov",
}
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/png", "image/jpeg", "image/webp", "image/gif",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain", "text/csv",
    "video/mp4", "video/quicktime",
    "application/octet-stream",
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
    suffix = PurePath(name).suffix.lower()
    if suffix not in ALLOWED_UPLOAD_EXTENSIONS:
        raise ValueError(f"File type '{suffix or 'none'}' is not allowed.")
    return name


def validate_upload_content(filename: str, mime_type: str | None, header: bytes) -> None:
    suffix = PurePath(filename).suffix.lower()
    mime = (mime_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if mime not in ALLOWED_MIME_TYPES:
        raise ValueError(f"MIME type '{mime}' is not allowed.")

    if suffix == ".pdf" and not header.startswith(b"%PDF-"):
        raise ValueError("PDF content signature is invalid.")
    if suffix == ".png" and not header.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("PNG content signature is invalid.")
    if suffix in {".jpg", ".jpeg"} and not header.startswith(b"\xff\xd8\xff"):
        raise ValueError("JPEG content signature is invalid.")
    if suffix == ".gif" and not header.startswith((b"GIF87a", b"GIF89a")):
        raise ValueError("GIF content signature is invalid.")
    if suffix == ".webp" and not (header.startswith(b"RIFF") and header[8:12] == b"WEBP"):
        raise ValueError("WebP content signature is invalid.")
    if suffix in {".docx", ".xlsx", ".pptx"} and not header.startswith(b"PK\x03\x04"):
        raise ValueError("Office document content signature is invalid.")
    if suffix in {".mp4", ".mov"} and b"ftyp" not in header[:32]:
        raise ValueError("Video content signature is invalid.")
    if suffix in {".txt", ".csv"} and b"\x00" in header:
        raise ValueError("Text upload contains binary content.")


def validate_external_url(value: str) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in ALLOWED_EXTERNAL_SCHEMES or not parsed.netloc:
        raise ValueError("Attachment URLs must use an absolute HTTP or HTTPS URL.")
    if parsed.username or parsed.password:
        raise ValueError("Attachment URLs must not contain embedded credentials.")
    return candidate
