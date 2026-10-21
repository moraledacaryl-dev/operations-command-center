"""Legacy integration endpoints cannot forge source identity or review state."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.routers.api import (
    STAFF_EVENTS,
    ACCOUNTING_EVENTS,
    POS_EVENTS,
    store_external_review_item,
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.mark.parametrize("source,allowed,event_type", [
    ("hidden_oasis_staff_payroll", STAFF_EVENTS, "staff.operations.snapshot"),
    ("accounting_program", ACCOUNTING_EVENTS, "payroll_import.pending_review"),
    ("dedicated_pos_cloud", POS_EVENTS, "daily_sales_context"),
])
@pytest.mark.parametrize("forged_source", ["accounting_program", "dedicated_pos_cloud", "inventory_procurement"])
def test_route_source_must_match_payload_identity(db, source, allowed, event_type, forged_source):
    if forged_source == source:
        return
    event = {
        "external_source": forged_source,
        "external_id": f"forged-{source}-{forged_source}",
        "event_type": event_type,
        "payload": {"counts": {"pending": 1}},
    }
    with pytest.raises(HTTPException) as exc:
        store_external_review_item(db, event, allowed, source)
    assert exc.value.status_code == 400
    assert "external_source" in str(exc.value.detail)
    db.commit()
    assert db.query(models.ExternalReviewItem).count() == 0
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("source,allowed,event_type", [
    ("hidden_oasis_staff_payroll", STAFF_EVENTS, "staff.operations.snapshot"),
    ("accounting_program", ACCOUNTING_EVENTS, "payroll_import.pending_review"),
    ("dedicated_pos_cloud", POS_EVENTS, "daily_sales_context"),
])
@pytest.mark.parametrize("supplied_status", ["Approved", "Rejected", "Done", "Pending Approval", "In Progress", "Ready to Post"])
def test_incoming_source_status_cannot_bypass_review(db, source, allowed, event_type, supplied_status):
    incoming = {
        "external_source": source,
        "external_id": f"source-status-{source}-{supplied_status}",
        "event_type": event_type,
        "status": supplied_status,
        "payload": {"counts": {"pending": 2}},
    }
    result = store_external_review_item(db, incoming, allowed, source)
    assert result["status"] == "accepted"
    item = db.get(models.ExternalReviewItem, result["id"])
    assert item.external_source == source
    assert item.status == "For Review"
    assert db.query(models.ExternalReviewItem).count() == 1


def test_valid_replay_does_not_reopen_reviewed_item(db):
    event = {
        "external_source": "hidden_oasis_staff_payroll",
        "external_id": "canonical-source-replay",
        "event_type": "staff.operations.snapshot",
        "payload": {"counts": {"pending": 1}},
    }
    first = store_external_review_item(
        db, event, STAFF_EVENTS, "hidden_oasis_staff_payroll",
    )
    item = db.get(models.ExternalReviewItem, first["id"])
    item.status = "Seen"
    db.commit()
    second = store_external_review_item(
        db, {**event, "status": "Approved"}, STAFF_EVENTS, "hidden_oasis_staff_payroll",
    )
    assert second["status"] == "already_applied"
    db.refresh(item)
    assert item.status == "Seen"
    assert db.query(models.ExternalReviewItem).count() == 1


@pytest.mark.parametrize("source,allowed,event_type", [
    ("hidden_oasis_staff_payroll", STAFF_EVENTS, "staff.operations.snapshot"),
    ("accounting_program", ACCOUNTING_EVENTS, "payroll_import.pending_review"),
    ("dedicated_pos_cloud", POS_EVENTS, "daily_sales_context"),
])
def test_changed_business_facts_on_same_external_id_are_rejected_without_overwriting_review(
    db, source, allowed, event_type,
):
    original = {
        "external_source": source,
        "external_id": f"reused-{source}",
        "event_type": event_type,
        "payload": {"totals": {"amount": 1200}, "counts": {"open": 1}},
    }
    accepted = store_external_review_item(db, original, allowed, source)
    item = db.get(models.ExternalReviewItem, accepted["id"])
    item.status = "Seen"
    db.commit()
    stored_json = item.payload_json
    with pytest.raises(HTTPException) as exc:
        store_external_review_item(
            db,
            {**original, "payload": {"totals": {"amount": 1800}, "counts": {"open": 1}}},
            allowed,
            source,
        )
    assert exc.value.status_code == 409
    db.commit()
    db.refresh(item)
    assert item.status == "Seen"
    assert item.payload_json == stored_json
    assert db.query(models.ExternalReviewItem).count() == 1
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("source,allowed,first_type,changed_type", [
    ("hidden_oasis_staff_payroll", STAFF_EVENTS, "staff.operations.snapshot", "attendance.exception.created"),
    ("accounting_program", ACCOUNTING_EVENTS, "payroll_import.pending_review", "payable.due"),
    ("dedicated_pos_cloud", POS_EVENTS, "daily_sales_context", "drawer_variance.alert"),
])
def test_changed_event_type_cannot_reuse_legacy_id(db, source, allowed, first_type, changed_type):
    original = {
        "external_source": source,
        "external_id": f"changed-type-{source}",
        "event_type": first_type,
        "payload": {"counts": {"exceptions": 1}},
    }
    store_external_review_item(db, original, allowed, source)
    with pytest.raises(HTTPException) as exc:
        store_external_review_item(db, {**original, "event_type": changed_type}, allowed, source)
    assert exc.value.status_code == 409
    assert db.query(models.ExternalReviewItem).one().event_type == first_type


def test_identical_replay_ignores_object_key_order_and_untrusted_status(db):
    event = {
        "external_source": "dedicated_pos_cloud",
        "external_id": "pos-reordered",
        "event_type": "daily_sales_context",
        "status": "Approved",
        "payload": {"totals": {"sales": 550, "orders": 3}},
    }
    first = store_external_review_item(db, event, POS_EVENTS, "dedicated_pos_cloud")
    replay = {
        "payload": {"totals": {"orders": 3, "sales": 550}},
        "event_type": "daily_sales_context",
        "status": "Rejected",
        "external_id": "pos-reordered",
        "external_source": "dedicated_pos_cloud",
    }
    second = store_external_review_item(db, replay, POS_EVENTS, "dedicated_pos_cloud")
    assert second == {"status": "already_applied", "id": first["id"]}
    item = db.get(models.ExternalReviewItem, first["id"])
    assert item.status == "For Review"
    assert "Approved" not in item.payload_json
    assert "Rejected" not in item.payload_json


def test_legacy_rows_with_old_incoming_status_are_still_idempotent(db):
    event = {
        "external_source": "hidden_oasis_staff_payroll",
        "external_id": "pre-hardening-legacy-row",
        "event_type": "staff.operations.snapshot",
        "payload": {"counts": {"attendance_exceptions": 2}},
    }
    first = store_external_review_item(db, event, STAFF_EVENTS, "hidden_oasis_staff_payroll")
    row = db.get(models.ExternalReviewItem, first["id"])
    import json
    old = json.loads(row.payload_json)
    old["status"] = "Rejected"  # historical legacy receiver stored supplied status
    row.payload_json = json.dumps(old)
    row.status = "Seen"
    db.commit()
    replay = store_external_review_item(db, {**event, "status": "Approved"}, STAFF_EVENTS, "hidden_oasis_staff_payroll")
    assert replay == {"status": "already_applied", "id": row.id}
    db.refresh(row)
    assert row.status == "Seen"
    assert json.loads(row.payload_json)["status"] == "Rejected"


def test_private_scrubbed_field_difference_does_not_recreate_review_item(db):
    event = {
        "external_source": "hidden_oasis_staff_payroll",
        "external_id": "private-fields-ignore",
        "event_type": "staff.operations.snapshot",
        "payload": {"counts": {"pending": 2}, "hourly_rate": 120},
    }
    first = store_external_review_item(db, event, STAFF_EVENTS, "hidden_oasis_staff_payroll")
    repeat = store_external_review_item(
        db,
        {**event, "payload": {"counts": {"pending": 2}, "hourly_rate": 500}},
        STAFF_EVENTS,
        "hidden_oasis_staff_payroll",
    )
    assert repeat == {"status": "already_applied", "id": first["id"]}
    assert db.query(models.ExternalReviewItem).count() == 1
    assert "hourly_rate" not in db.get(models.ExternalReviewItem, first["id"]).payload_json


def test_unparseable_existing_legacy_payload_fails_closed(db):
    original = {
        "external_source": "accounting_program",
        "external_id": "corrupt-payload",
        "event_type": "payroll_import.pending_review",
        "payload": {"counts": {"pending": 1}},
    }
    first = store_external_review_item(db, original, ACCOUNTING_EVENTS, "accounting_program")
    item = db.get(models.ExternalReviewItem, first["id"])
    item.payload_json = "{invalid-stored-data"
    db.commit()
    with pytest.raises(HTTPException) as exc:
        store_external_review_item(db, original, ACCOUNTING_EVENTS, "accounting_program")
    assert exc.value.status_code == 409
    assert db.query(models.ExternalReviewItem).count() == 1
