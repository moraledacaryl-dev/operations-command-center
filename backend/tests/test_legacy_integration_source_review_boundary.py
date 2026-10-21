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
