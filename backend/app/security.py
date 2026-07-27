from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse


DEFAULT_SESSION_SECRET = "local-command-center-secret"
PLACEHOLDER_VALUES = {
    "",
    "change-me",
    "changeme",
    "default",
    "local-command-center-secret",
    "placeholder",
    "replace-with-shared-secret",
}


def _csv(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(value.strip() for value in os.getenv(name, default).split(",") if value.strip())


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _is_placeholder(value: str) -> bool:
    normalized = (value or "").strip().lower()
    return normalized in PLACEHOLDER_VALUES or normalized.startswith(("change_me", "changeme", "replace"))


def _origin_is_valid(origin: str) -> bool:
    parsed = urlparse(origin)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc) and not parsed.path.strip("/")


@dataclass(frozen=True)
class SecuritySettings:
    environment: str
    session_secret: str
    integration_api_key: str
    allowed_origins: tuple[str, ...]
    allowed_hosts: tuple[str, ...]
    force_https: bool
    expose_api_docs: bool

    @property
    def production(self) -> bool:
        return self.environment == "production"


def load_security_settings() -> SecuritySettings:
    environment = os.getenv("ENVIRONMENT", "development").strip().lower()
    production = environment == "production"
    return SecuritySettings(
        environment=environment,
        session_secret=os.getenv("SESSION_SECRET", DEFAULT_SESSION_SECRET).strip(),
        integration_api_key=os.getenv("INTEGRATION_API_KEY", "").strip(),
        allowed_origins=_csv(
            "ALLOWED_ORIGINS",
            "https://operations.hiddenoasis.app" if production else "http://localhost:3000,http://127.0.0.1:3000",
        ),
        allowed_hosts=_csv(
            "ALLOWED_HOSTS",
            "operations.hiddenoasis.app,localhost,127.0.0.1" if production else "localhost,127.0.0.1,testserver",
        ),
        force_https=_bool("FORCE_HTTPS", production),
        expose_api_docs=_bool("EXPOSE_API_DOCS", not production),
    )


def validate_security_settings(settings: SecuritySettings) -> None:
    errors: list[str] = []

    if not settings.allowed_origins:
        errors.append("ALLOWED_ORIGINS must contain at least one explicit origin.")
    invalid_origins = [origin for origin in settings.allowed_origins if not _origin_is_valid(origin)]
    if invalid_origins:
        errors.append(f"ALLOWED_ORIGINS contains invalid origins: {', '.join(invalid_origins)}")
    if "*" in settings.allowed_origins:
        errors.append("Wildcard CORS origins are not allowed when credentials are enabled.")
    if not settings.allowed_hosts or "*" in settings.allowed_hosts:
        errors.append("ALLOWED_HOSTS must contain explicit hostnames and may not use a wildcard.")

    if settings.production:
        if _is_placeholder(settings.session_secret) or len(settings.session_secret) < 32:
            errors.append("SESSION_SECRET must be a unique production secret of at least 32 characters.")
        if _is_placeholder(settings.integration_api_key) or len(settings.integration_api_key) < 24:
            errors.append("INTEGRATION_API_KEY must be a unique production secret of at least 24 characters.")
        if any(not origin.startswith("https://") for origin in settings.allowed_origins):
            errors.append("Production ALLOWED_ORIGINS must use HTTPS.")

    if errors:
        joined = " ".join(errors)
        raise RuntimeError(f"Unsafe security configuration: {joined}")
