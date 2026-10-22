"""Cross-source receiver contract checks; synthetic SQLite-only evidence.

These tests never send HTTP to production, create operational source events, or
claim that a live producer has successfully delivered in the last 168 hours.
"""

import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.foundation_models import IntegrationEventInbox
from app.integration_models import IntegrationDelivery
from app.routers.integrations_v2 import (
    SOURCE_EVENT_TYPES,
    IntegrationEventEnvelope,
    receive_event,
)


SOURCE_KEYS = {
    "hidden_oasis_staff_payroll": "staff-test-key",
    "accounting_program": "accounting-test-key",
    "dedicated_pos_cloud": "pos-test-key",
    "inventory_procurement": "inventory-test-key",
}


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", future=True)
    session_factory = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, future=True
    )
    Base.metadata.create_all(bind=engine)
    with session_factory() as session:
        yield session
    engine.dispose()


@pytest.fixture(autouse=True)
def isolated_production_like_keys(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("INTEGRATION_API_KEYS_JSON", json.dumps(SOURCE_KEYS))
    monkeypatch.delenv("INTEGRATION_API_KEY", raising=False)


def envelope(event_id: str, event_type: str) -> IntegrationEventEnvelope:
    return IntegrationEventEnvelope(
        event_id=event_id,
        event_type=event_type,
        subject={"type": "certification_fixture", "id": "fixture-only"},
        payload={
            "counts": {"fixture": 1},
            "salary": "sensitive-test-marker",
            "summary": "sensitive-narrative-marker",
        },
    )


ALL_SUPPORTED_EVENTS = [
    (source, event_type)
    for source, types in sorted(SOURCE_EVENT_TYPES.items())
    for event_type in sorted(types)
]


@pytest.mark.parametrize(
    "source,event_type",
    ALL_SUPPORTED_EVENTS,
    ids=[f"{source}/{event_type}" for source, event_type in ALL_SUPPORTED_EVENTS],
)
def test_every_source_event_has_atomic_receipt_and_idempotent_replay(
    db, source, event_type
):
    event = envelope(f"group-c-fixture:{source}:{event_type}", event_type)
    first = receive_event(
        source, event, x_integration_api_key=SOURCE_KEYS[source], db=db
    )
    assert first["status"] == "accepted"
    assert db.query(IntegrationDelivery).count() == 1
    assert db.query(IntegrationEventInbox).count() == 1
    assert db.query(models.ExternalReviewItem).count() == 1

    delivery = db.query(IntegrationDelivery).one()
    inbox = db.query(IntegrationEventInbox).one()
    review = db.query(models.ExternalReviewItem).one()
    assert delivery.status == "processed"
    assert delivery.source_app == inbox.source_app == review.external_source == source
    assert delivery.event_id == inbox.external_event_id == review.external_id
    assert review.event_type == event_type
    assert "sensitive-test-marker" not in (review.payload_json or "")
    assert "sensitive-narrative-marker" not in (inbox.payload_json or "")

    review.status = "Seen"
    db.commit()
    replay = receive_event(
        source, event, x_integration_api_key=SOURCE_KEYS[source], db=db
    )
    assert replay == {
        "status": "already_applied", "delivery_id": first["delivery_id"]
    }
    assert db.query(IntegrationDelivery).count() == 1
    assert db.query(IntegrationEventInbox).count() == 1
    assert db.query(models.ExternalReviewItem).one().status == "Seen"


def test_same_external_event_id_is_scoped_to_each_source(db):
    event_id = "group-c-fixture:shared-identity"
    for source in SOURCE_KEYS:
        event_type = sorted(SOURCE_EVENT_TYPES[source])[0]
        result = receive_event(
            source, envelope(event_id, event_type),
            x_integration_api_key=SOURCE_KEYS[source], db=db,
        )
        assert result["status"] == "accepted"
    assert db.query(IntegrationDelivery).count() == 4
    assert db.query(IntegrationEventInbox).count() == 4
    assert db.query(models.ExternalReviewItem).count() == 4


@pytest.mark.parametrize("source", sorted(SOURCE_KEYS))
def test_other_source_credential_never_creates_a_receipt(db, source):
    other_source = next(item for item in SOURCE_KEYS if item != source)
    event_type = sorted(SOURCE_EVENT_TYPES[source])[0]
    with pytest.raises(HTTPException) as exc:
        receive_event(
            source, envelope(f"group-c-fixture:wrong-key:{source}", event_type),
            x_integration_api_key=SOURCE_KEYS[other_source], db=db,
        )
    assert exc.value.status_code == 401
    assert db.query(IntegrationDelivery).count() == 0
    assert db.query(IntegrationEventInbox).count() == 0
    assert db.query(models.ExternalReviewItem).count() == 0


@pytest.mark.parametrize("source", sorted(SOURCE_KEYS))
def test_review_unique_conflict_rolls_back_delivery_and_inbox(db, source):
    event_type = sorted(SOURCE_EVENT_TYPES[source])[0]
    event_id = f"group-c-fixture:existing-review:{source}"
    original = models.ExternalReviewItem(
        external_source=source,
        external_id=event_id,
        source_app=source,
        event_type=event_type,
        title="Pre-existing review",
        status="Seen",
    )
    db.add(original)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        receive_event(
            source, envelope(event_id, event_type),
            x_integration_api_key=SOURCE_KEYS[source], db=db,
        )
    assert exc.value.status_code == 409
    assert db.query(IntegrationDelivery).count() == 0
    assert db.query(IntegrationEventInbox).count() == 0
    assert db.query(models.ExternalReviewItem).one().status == "Seen"
