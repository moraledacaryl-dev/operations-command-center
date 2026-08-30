from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class TrustedProxySettings:
    trust_proxy_headers: bool = False
    trusted_proxy_ips: frozenset[str] = frozenset()

    @classmethod
    def from_env(cls) -> "TrustedProxySettings":
        trusted = frozenset(
            normalized
            for value in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
            if (normalized := normalize_ip(value))
        )
        return cls(
            trust_proxy_headers=os.getenv("TRUST_PROXY_HEADERS", "false").strip().lower() in {"1", "true", "yes", "on"},
            trusted_proxy_ips=trusted,
        )


def normalize_ip(value: object) -> str | None:
    try:
        return str(ipaddress.ip_address(str(value or "").strip()))
    except ValueError:
        return None


def _headers(scope) -> dict[str, str]:
    return {
        key.decode("latin-1").lower(): value.decode("latin-1")
        for key, value in scope.get("headers", [])
    }


def trusted_client_ip(scope, settings: TrustedProxySettings) -> str:
    client = scope.get("client")
    peer = normalize_ip(client[0]) if client else None
    if not settings.trust_proxy_headers or not peer or peer not in settings.trusted_proxy_ips:
        return peer or "unknown"

    headers = _headers(scope)
    forwarded = headers.get("x-forwarded-for", "")
    candidate = normalize_ip(forwarded.split(",", 1)[0]) if forwarded else None
    if candidate:
        return candidate
    real_ip = normalize_ip(headers.get("x-real-ip", ""))
    return real_ip or peer


__all__ = ["TrustedProxySettings", "normalize_ip", "trusted_client_ip"]
