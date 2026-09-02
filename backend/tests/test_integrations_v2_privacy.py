import json

import pytest
from fastapi import HTTPException

from app.routers.integrations_v2 import (
    IntegrationEventEnvelope,
    _authenticate_source,
    _canonical_payload,
    _event_summary,
    _event_title,
    _payload_hash,
    _source_keys,
)


def test_v2_scrubs_nested_private_and_narrative_fields():
    event = IntegrationEventEnvelope(
        event_id="evt-privacy-1",
        event_type="staff.operations.snapshot",
        title="SENTINEL_TITLE",
        summary="SENTINEL_SUMMARY",
        payload={
            "counts": {"attendance_exceptions": 1},
            "note": "SENTINEL_NOTE",
            "reason": "SENTINEL_REASON",
            "description": "SENTINEL_DESCRIPTION",
            "employee": {
                "name": "Visible operational name",
                "hourly_rate": 999,
                "private_hr_notes": "SENTINEL_PRIVATE_HR",
                "bank_account": "SENTINEL_ACCOUNT",
            },
            "rows": [{"government_id": "SENTINEL_ID", "safe_status": "pending"}],
        },
        metadata={"safe_marker": "ok"},
    )

    payload = _canonical_payload(event)
    encoded = json.dumps(payload)

    for forbidden in (
        "title",
        "summary",
        "note",
        "reason",
        "description",
        "hourly_rate",
        "private_hr_notes",
        "bank_account",
        "government_id",
        "SENTINEL_TITLE",
        "SENTINEL_SUMMARY",
        "SENTINEL_NOTE",
        "SENTINEL_REASON",
        "SENTINEL_DESCRIPTION",
        "SENTINEL_PRIVATE_HR",
        "SENTINEL_ACCOUNT",
        "SENTINEL_ID",
    ):
        assert forbidden not in encoded

    assert payload["payload"]["employee"]["name"] == "Visible operational name"
    assert payload["payload"]["rows"][0]["safe_status"] == "pending"
    assert payload["metadata"]["safe_marker"] == "ok"


def test_review_card_uses_event_type_and_structured_aggregates_only():
    event = IntegrationEventEnvelope(
        event_id="evt-privacy-2",
        event_type="payroll.ready_for_owner_review",
        title="SENTINEL_TITLE",
        summary="SENTINEL_SUMMARY",
        payload={
            "summary": "SENTINEL_NESTED_SUMMARY",
            "counts": {"payroll_ready_for_owner_review": 1},
        },
    )
    payload = _canonical_payload(event)

    assert _event_title(event) == "Payroll Ready For Owner Review"
    assert _event_summary(payload) == "payroll_ready_for_owner_review: 1"
    assert "SENTINEL" not in json.dumps(payload)


def test_source_specific_keys_cannot_cross_source(monkeypatch):
    monkeypatch.setenv(
        "INTEGRATION_API_KEYS_JSON",
        json.dumps(
            {
                "hidden_oasis_staff_payroll": "source-a",
                "accounting_program": "source-b",
                "dedicated_pos_cloud": "source-c",
                "inventory_procurement": "source-d",
            }
        ),
    )

    _authenticate_source("hidden_oasis_staff_payroll", "source-a")
    with pytest.raises(HTTPException) as exc:
        _authenticate_source("dedicated_pos_cloud", "source-a")
    assert exc.value.status_code == 401


def test_production_rejects_legacy_shared_integration_key(monkeypatch):
    monkeypatch.delenv("INTEGRATION_API_KEYS_JSON", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("INTEGRATION_API_KEY", "legacy-shared-key")

    with pytest.raises(HTTPException) as exc:
        _source_keys()

    assert exc.value.status_code == 503
    assert "source-specific" in exc.value.detail


def test_nonproduction_keeps_legacy_shared_key_compatibility(monkeypatch):
    monkeypatch.delenv("INTEGRATION_API_KEYS_JSON", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("INTEGRATION_API_KEY", "legacy-shared-key")

    keys = _source_keys()

    assert set(keys) == set((
        "hidden_oasis_staff_payroll",
        "accounting_program",
        "dedicated_pos_cloud",
        "inventory_procurement",
    ))
    assert set(keys.values()) == {"legacy-shared-key"}


def test_production_accepts_source_specific_json_even_if_legacy_key_is_present(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("INTEGRATION_API_KEY", "legacy-shared-key")
    monkeypatch.setenv(
        "INTEGRATION_API_KEYS_JSON",
        json.dumps(
            {
                "hidden_oasis_staff_payroll": "source-a",
                "accounting_program": "source-b",
                "dedicated_pos_cloud": "source-c",
                "inventory_procurement": "source-d",
            }
        ),
    )

    keys = _source_keys()

    assert len(keys) == 4
    assert len(set(keys.values())) == 4
    assert keys["hidden_oasis_staff_payroll"] == "source-a"


def test_replay_digest_ignores_scrubbed_private_value_changes():
    first = IntegrationEventEnvelope(
        event_id="evt-replay-1",
        event_type="staff.operations.snapshot",
        payload={"counts": {"attendance_exceptions": 1}, "hourly_rate": 999},
    )
    second = IntegrationEventEnvelope(
        event_id="evt-replay-1",
        event_type="staff.operations.snapshot",
        payload={"counts": {"attendance_exceptions": 1}, "hourly_rate": 1234},
    )

    assert _payload_hash(_canonical_payload(first)) == _payload_hash(_canonical_payload(second))


def test_replay_digest_changes_for_operational_payload_change():
    first = IntegrationEventEnvelope(
        event_id="evt-replay-2",
        event_type="staff.operations.snapshot",
        payload={"counts": {"attendance_exceptions": 1}},
    )
    second = IntegrationEventEnvelope(
        event_id="evt-replay-2",
        event_type="staff.operations.snapshot",
        payload={"counts": {"attendance_exceptions": 2}},
    )

    assert _payload_hash(_canonical_payload(first)) != _payload_hash(_canonical_payload(second))
