"""Acceptance verdicts preserve live runtime failures and historical exceptions."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.certify_operations_readiness import (
    assemble_report,
    fetch_health,
    release_identity,
    service_active,
    summarize_integrations,
)


SHA = "a" * 40
KNOWN_SOURCES = (
    "accounting_program",
    "dedicated_pos_cloud",
    "hidden_oasis_staff_payroll",
    "inventory_procurement",
)


def delivery_fixture(*, missing_review: int = 0, old_only: bool = False, complete: bool = True):
    return {
        "totals": {
            "missing_review": missing_review,
            "missing_inbox": 0,
            "unprocessed_deliveries": 0,
        },
        "structural_integrity": "investigate" if missing_review else "pass",
        "all_sources_observed_recently": not old_only,
        "sources": {
            source: {
                "delivery_observation": "no_recent_event" if old_only else "recent_event_observed"
            } for source in KNOWN_SOURCES
        },
        "diagnostics": {
            "truncated": not complete,
            "deliveries": [
                {
                    "identity_hint": "suspected_connectivity_test",
                    "event_id": f"PRIVATE-CERT-{i}",
                    "source_app": KNOWN_SOURCES[i % len(KNOWN_SOURCES)],
                    "inbox_id": i + 1,
                    "review_id": None,
                } for i in range(missing_review)
            ],
        },
    }


def assemble(*, missing_review: int = 0, old_only: bool = False, ready: bool = True):
    return assemble_report(
        expected_sha=SHA,
        live={"release_sha": SHA},
        ready={"release_sha": SHA, "ready": ready},
        active_release_sha=SHA,
        services={"operations-backend": True, "operations-frontend": True},
        receiver={"all_sources_configured": True, "configuration_valid": True},
        delivery=delivery_fixture(missing_review=missing_review, old_only=old_only),
    )


def test_good_runtime_and_integrity_still_requires_human_signoff():
    report = assemble(old_only=True)
    assert report["read_only"] is True
    assert report["exit_code"] == 0
    assert report["runtime_readiness"] == "pass"
    assert report["final_acceptance"] == "requires_human_device_and_workflow_signoff"
    assert report["producer_outboxes"] == "not_checked_by_this_read_only_receiver_audit"
    assert report["integration_delivery"]["all_sources_observed_recently"] is False
    assert report["integration_delivery"]["no_recent_events_is_not_a_failure"] is True


def test_historical_certification_hints_never_waive_missing_review():
    report = assemble(missing_review=4, old_only=True)
    assert report["runtime_readiness"] == "pass"
    assert report["exit_code"] == 2
    assert report["final_acceptance"] == "requires_manual_integrity_review"
    assert report["integration_delivery"]["aggregate_findings"]["missing_review"] == 4
    assert report["integration_delivery"]["suspected_connectivity_test_rows"] == 4
    assert report["historical_exceptions_automatically_repaired"] is False
    # The report is safe to share: no raw event identifiers, subject IDs,
    # credentials, or narrative payload from delivery diagnostics.
    rendered = json.dumps(report)
    assert "PRIVATE-CERT" not in rendered
    assert "inbox_id" not in rendered
    assert "review_id" not in rendered


@pytest.mark.parametrize("failure", [
    "live", "ready", "release", "backend", "frontend", "receiver", "readiness_false"
])
def test_runtime_failure_is_a_blocker_even_when_integrations_have_exceptions(failure):
    kwargs = dict(
        expected_sha=SHA,
        live={"release_sha": SHA},
        ready={"release_sha": SHA, "ready": True},
        active_release_sha=SHA,
        services={"operations-backend": True, "operations-frontend": True},
        receiver={"all_sources_configured": True, "configuration_valid": True},
        delivery=delivery_fixture(missing_review=4),
    )
    if failure == "live":
        kwargs["live"] = None
    elif failure == "ready":
        kwargs["ready"] = {"release_sha": "b" * 40, "ready": True}
    elif failure == "release":
        kwargs["active_release_sha"] = "b" * 40
    elif failure == "backend":
        kwargs["services"]["operations-backend"] = False
    elif failure == "frontend":
        kwargs["services"]["operations-frontend"] = False
    elif failure == "receiver":
        kwargs["receiver"]["all_sources_configured"] = False
    elif failure == "readiness_false":
        kwargs["ready"]["ready"] = False
    report = assemble_report(**kwargs)
    assert report["exit_code"] == 1
    assert report["runtime_readiness"] == "fail"
    assert report["final_acceptance"] == "blocked_runtime"
    assert report["integration_delivery"]["structural_integrity"] == "investigate"


def test_missing_receiver_distinctness_does_not_look_healthy():
    report = assemble_report(
        expected_sha=SHA,
        live={"release_sha": SHA},
        ready={"release_sha": SHA, "ready": True},
        active_release_sha=SHA,
        services={"operations-backend": True, "operations-frontend": True},
        receiver={"all_sources_configured": False, "configuration_valid": False},
        delivery=delivery_fixture(),
    )
    assert report["runtime_checks"]["receiver_credentials_valid"] is False
    assert report["exit_code"] == 1


def test_diagnostic_truncation_is_explicit_not_a_clean_classification():
    details = summarize_integrations(delivery_fixture(missing_review=4, complete=False))
    assert details["diagnostics_truncated"] is True
    assert details["suspected_connectivity_test_rows"] == 4
    assert details["structural_integrity"] == "investigate"


def test_release_identity_is_exact_immutable_release(tmp_path):
    releases = tmp_path / "releases"
    releases.mkdir()
    candidate = releases / SHA
    candidate.mkdir()
    current = tmp_path / "current"
    current.symlink_to(candidate, target_is_directory=True)
    assert release_identity(current) == SHA

    current.unlink()
    current.symlink_to(tmp_path / "not-a-release")
    assert release_identity(current) is None

    direct = tmp_path / "not-a-release"
    direct.mkdir()
    current.unlink()
    current.symlink_to(direct, target_is_directory=True)
    assert release_identity(current) is None


def test_health_rejects_non_https_without_network(monkeypatch):
    import scripts.certify_operations_readiness as target

    def forbidden(*_args, **_kwargs):
        raise AssertionError("network must not be used")
    monkeypatch.setattr(target, "urlopen", forbidden)
    assert fetch_health("http://localhost:8000/api/livez") is None


def test_service_lookup_unavailable_is_false(monkeypatch):
    import scripts.certify_operations_readiness as target

    def missing(*_args, **_kwargs):
        raise OSError("service manager not installed")
    monkeypatch.setattr(target.subprocess, "run", missing)
    assert service_active("operations-backend") is False
