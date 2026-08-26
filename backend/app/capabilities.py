from __future__ import annotations

from typing import Final

CAPABILITIES: Final[tuple[str, ...]] = (
    "view_all_operations",
    "manage_department",
    "make_decisions",
    "manage_accounts",
    "manage_system",
    "view_system_health",
    "manage_approvals",
    "view_sensitive_user_metadata",
    "view_integration_summary",
)

ROLE_CAPABILITIES: Final[dict[str, frozenset[str]]] = {
    "owner": frozenset(CAPABILITIES),
    "admin": frozenset({
        "view_all_operations",
        "manage_department",
        "make_decisions",
        "manage_accounts",
        "manage_system",
        "view_system_health",
        "manage_approvals",
        "view_sensitive_user_metadata",
        "view_integration_summary",
    }),
    "manager": frozenset({
        "view_all_operations",
        "manage_department",
        "make_decisions",
        "view_system_health",
        "manage_approvals",
        "view_integration_summary",
    }),
    "lead": frozenset({"manage_department"}),
    "supervisor": frozenset({"manage_department"}),
    "staff": frozenset(),
}


def normalize_role(role: object) -> str:
    return str(role or "").strip().lower()


def capabilities_for_role(role: object) -> frozenset[str]:
    return ROLE_CAPABILITIES.get(normalize_role(role), frozenset())


def has_capability(role: object, capability: str) -> bool:
    return capability in capabilities_for_role(role)


def capability_payload(role: object) -> dict[str, bool]:
    granted = capabilities_for_role(role)
    return {capability: capability in granted for capability in CAPABILITIES}
