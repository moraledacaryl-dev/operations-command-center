"""Read-only, credential-safe post-deployment Operations acceptance evidence.

This tool does not create/replay events, write to the database, restart
services, or convert historical certification-shaped gaps into clean records.
Exit 0: runtime and structural checks passed (human sign-off still required).
Exit 2: runtime passed but integration integrity needs investigation.
Exit 1: runtime or receiver configuration failed.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from sqlalchemy import text

from scripts.audit_integration_deliveries import (
    audit_delivery_integrity,
    audit_receiver_configuration,
)

_SHA = re.compile(r"^[0-9a-f]{40}$")
_SERVICES = ("operations-backend", "operations-frontend")


def release_identity(current: Path) -> str | None:
    """Only accept an existing immutable release underneath sibling releases."""
    try:
        target = current.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if target.parent != current.parent / "releases" or not _SHA.fullmatch(target.name):
        return None
    return target.name


def service_active(name: str) -> bool:
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "--quiet", name],
            capture_output=True, timeout=5, check=False,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def fetch_health(url: str) -> dict[str, Any] | None:
    """Only use HTTPS; do not expose HTTP response bodies on failures."""
    if not url.startswith("https://"):
        return None
    try:
        with urlopen(url, timeout=6) as response:
            value = json.load(response)
        return value if isinstance(value, dict) else None
    except (HTTPError, URLError, OSError, ValueError, UnicodeError):
        return None


def summarize_integrations(report: dict[str, Any]) -> dict[str, Any]:
    totals = report["totals"]
    diagnostics = report.get("diagnostics", {})
    exceptions = diagnostics.get("deliveries", [])
    hints = Counter(entry.get("identity_hint", "unclassified") for entry in exceptions)
    missing = totals["missing_review"] + totals["missing_inbox"] + totals["unprocessed_deliveries"]
    # A nonzero aggregate may double-count a single delivery; be precise
    # about the number of findings, not inferred distinct records.
    return {
        "structural_integrity": report["structural_integrity"],
        "aggregate_findings": {
            name: int(totals[name])
            for name in ("missing_review", "missing_inbox", "unprocessed_deliveries")
        },
        "diagnostic_rows_examined": len(exceptions),
        "diagnostics_truncated": bool(diagnostics.get("truncated")),
        "suspected_connectivity_test_rows": hints["suspected_connectivity_test"],
        "unclassified_diagnostic_rows": hints["unclassified"],
        "all_sources_observed_recently": report["all_sources_observed_recently"],
        "source_delivery_observations": {
            source: detail["delivery_observation"]
            for source, detail in report["sources"].items()
        },
        "interpretation": (
            "Needs manual provenance and Review-link investigation; identity hints never waive findings."
            if missing else
            "No delivery-to-Inbox/Review structural findings observed."
        ),
        "no_recent_events_is_not_a_failure": True,
    }


def assemble_report(
    *,
    expected_sha: str,
    live: dict[str, Any] | None,
    ready: dict[str, Any] | None,
    active_release_sha: str | None,
    services: dict[str, bool],
    receiver: dict[str, Any],
    delivery: dict[str, Any],
) -> dict[str, Any]:
    runtime = {
        "active_release_matches_expected": active_release_sha == expected_sha,
        "liveness_sha_matches_expected": bool(live and live.get("release_sha") == expected_sha),
        "readiness_sha_matches_expected": bool(ready and ready.get("release_sha") == expected_sha),
        "readiness_true": bool(ready and ready.get("ready") is True),
        "service_active": {name: bool(services.get(name)) for name in _SERVICES},
        "receiver_sources_configured": bool(receiver["all_sources_configured"]),
        "receiver_credentials_valid": bool(receiver["configuration_valid"]),
    }
    operational = all([
        runtime["active_release_matches_expected"],
        runtime["liveness_sha_matches_expected"],
        runtime["readiness_sha_matches_expected"],
        runtime["readiness_true"],
        runtime["receiver_sources_configured"],
        runtime["receiver_credentials_valid"],
        *runtime["service_active"].values(),
    ])
    integration = summarize_integrations(delivery)
    has_findings = integration["structural_integrity"] != "pass"
    return {
        "read_only": True,
        "expected_sha": expected_sha,
        "runtime_checks": runtime,
        "runtime_readiness": "pass" if operational else "fail",
        "integration_delivery": integration,
        "final_acceptance": (
            "blocked_runtime" if not operational
            else "requires_manual_integrity_review" if has_findings
            else "requires_human_device_and_workflow_signoff"
        ),
        "producer_outboxes": "not_checked_by_this_read_only_receiver_audit",
        "human_device_and_workflow_signoff": "not_checked",
        "historical_exceptions_automatically_repaired": False,
        "exit_code": 1 if not operational else 2 if has_findings else 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Release identity, health, receiver credentials and read-only delivery integrity."
    )
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--public-url", default="https://operations.hiddenoasis.app")
    parser.add_argument("--current", type=Path, default=Path("/opt/operations-command-center/current"))
    parser.add_argument("--hours", type=int, default=168)
    parser.add_argument("--diagnostic-limit", type=int, default=25)
    args = parser.parse_args()
    if not _SHA.fullmatch(args.expected_sha):
        parser.error("--expected-sha must be a lowercase full 40-character commit SHA")
    if args.hours < 1 or not 1 <= args.diagnostic_limit <= 100:
        parser.error("--hours must be positive; --diagnostic-limit must be 1..100")
    if not args.public_url.startswith("https://") or "@" in args.public_url:
        parser.error("--public-url must be HTTPS without embedded credentials")

    from app.database import SessionLocal

    with SessionLocal() as db:
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SET TRANSACTION READ ONLY"))
        delivery = audit_delivery_integrity(
            db, hours=args.hours, diagnostic_limit=args.diagnostic_limit
        )
        db.rollback()

    report = assemble_report(
        expected_sha=args.expected_sha,
        live=fetch_health(args.public_url.rstrip("/") + "/api/livez"),
        ready=fetch_health(args.public_url.rstrip("/") + "/api/readyz"),
        active_release_sha=release_identity(args.current),
        services={name: service_active(name) for name in _SERVICES},
        receiver=audit_receiver_configuration(),
        delivery=delivery,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return report["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
