from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from typing import Iterable, Optional


PASSWORD_SCHEME = "pbkdf2_sha256"
PBKDF2_ITERATIONS = int(os.getenv("PASSWORD_PBKDF2_ITERATIONS", "390000"))
STARTER_PASSWORDS = {"", "command123", "changeme", "password", "admin123"}


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def normalize_email(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def hash_password(password: str, *, iterations: int = PBKDF2_ITERATIONS) -> str:
    if not isinstance(password, str) or not password:
        raise ValueError("Password is required.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
    return f"{PASSWORD_SCHEME}${int(iterations)}${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, stored_hash: Optional[str]) -> bool:
    if not password or not stored_hash:
        return False
    try:
        scheme, iterations, salt, expected = stored_hash.split("$", 3)
        if scheme != PASSWORD_SCHEME:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _b64decode(salt), int(iterations))
        return hmac.compare_digest(_b64encode(digest), expected)
    except Exception:
        return False


def password_strength_warnings(password: str) -> list[str]:
    warnings: list[str] = []
    value = password or ""
    if len(value) < 12:
        warnings.append("Password must be at least 12 characters.")
    checks: Iterable[tuple[bool, str]] = (
        (any(ch.islower() for ch in value), "lowercase"),
        (any(ch.isupper() for ch in value), "uppercase"),
        (any(ch.isdigit() for ch in value), "number"),
        (any(not ch.isalnum() for ch in value), "symbol"),
    )
    passed = sum(1 for ok, _label in checks if ok)
    if passed < 3:
        warnings.append("Password must include at least three of: lowercase, uppercase, number, symbol.")
    if value.strip().lower() in STARTER_PASSWORDS:
        warnings.append("Password cannot use a starter or common value.")
    return warnings


def validate_password_strength(password: str) -> None:
    warnings = password_strength_warnings(password)
    if warnings:
        raise ValueError(" ".join(warnings))


def looks_like_starter_password(password: Optional[str]) -> bool:
    value = (password or "").strip().lower()
    return value in STARTER_PASSWORDS
