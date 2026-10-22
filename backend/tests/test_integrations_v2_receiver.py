import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.foundation_models import IntegrationEventInbox
from app.integration_models import IntegrationDelivery
from app.routers.integrations_v2 import IntegrationEventEnvelope, receive_event


def make_session():
    engine = create_engine("sqlite:///:memory:", future=True)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)
    return TestingSession()


def configure_source_keys(monkeypatch):
    monkeypatch.setenv(
        "INTEGRATION_API_KEYS_JSON",
        json.dumps(
            {
                "hidden_oasis_staff_payroll": "alpha",
                "accounting_program": "bravo",
                "dedicated_pos_cloud": "charlie",
                "inventory_procurement": "delta",
            }
        ),
    )


def staff_event(event_id="evt-v2-db-1", count=1):
    return IntegrationEventEnvelope(
        event_id=event_id,
        event_type="staff.operations.snapshot",
        payload={"counts": {"attendance_exceptions": count}},
    )


def test_v2_receiver_persists_one_delivery_inbox_and_review_item(monkeypatch):
    configure_source_keys(monkeypatch)
    db = make_session()

    result = receive_event(
        "hidden_oasis_staff_payroll",
        staff_event(),
        x_integration_api_key="alpha",
        db=db,
    )

    assert result["status"] == "accepted"
    assert db.query(IntegrationDelivery).count() == 1
    assert db.query(IntegrationEventInbox).count() == 1
    assert db.query(models.ExternalReviewItem).count() == 1


def test_v2_receiver_identical_replay_is_idempotent(monkeypatch):
    configure_source_keys(monkeypatch)
    db = make_session()

    first = receive_event(
        "hidden_oasis_staff_payroll",
        staff_event(),
        x_integration_api_key="alpha",
        db=db,
    )
    second = receive_event(
        "hidden_oasis_staff_payroll",
        staff_event(),
        x_integration_api_key="alpha",
        db=db,
    )

    assert first["status"] == "accepted"
    assert second == {"status": "already_applied", "delivery_id": first["delivery_id"]}
    assert db.query(IntegrationDelivery).count() == 1
    assert db.query(IntegrationEventInbox).count() == 1
    assert db.query(models.ExternalReviewItem).count() == 1


def test_v2_receiver_rejects_changed_payload_for_same_event_id(monkeypatch):
    configure_source_keys(monkeypatch)
    db = make_session()

    receive_event(
        "hidden_oasis_staff_payroll",
        staff_event(count=1),
        x_integration_api_key="alpha",
        db=db,
    )

    with pytest.raises(HTTPException) as exc:
        receive_event(
            "hidden_oasis_staff_payroll",
            staff_event(count=2),
            x_integration_api_key="alpha",
            db=db,
        )

    assert exc.value.status_code == 409
    assert db.query(IntegrationDelivery).count() == 1
    assert db.query(IntegrationEventInbox).count() == 1
    assert db.query(models.ExternalReviewItem).count() == 1


def test_v2_receiver_rejects_unsupported_event_type_before_persistence(monkeypatch):
    configure_source_keys(monkeypatch)
    db = make_session()
    event = IntegrationEventEnvelope(
        event_id="evt-v2-unsupported",
        event_type="payroll.run.paid",
        payload={"counts": {"items": 1}},
    )

    with pytest.raises(HTTPException) as exc:
        receive_event(
            "hidden_oasis_staff_payroll",
            event,
            x_integration_api_key="alpha",
            db=db,
        )

    assert exc.value.status_code == 400
    assert db.query(IntegrationDelivery).count() == 0
    assert db.query(IntegrationEventInbox).count() == 0
    assert db.query(models.ExternalReviewItem).count() == 0


@pytest.mark.parametrize("missing_link", ["review", "inbox", "unprocessed"])
def test_v2_replay_refuses_incomplete_historical_delivery(monkeypatch, missing_link):
    configure_source_keys(monkeypatch)
    db = make_session()
    event = staff_event(event_id=f"evt-v2-incomplete-{missing_link}")
    first = receive_event(
        "hidden_oasis_staff_payroll", event,
        x_integration_api_key="alpha", db=db,
    )
    delivery = db.get(IntegrationDelivery, first["delivery_id"])
    if missing_link == "review":
        db.query(models.ExternalReviewItem).delete()
    elif missing_link == "inbox":
        db.query(IntegrationEventInbox).delete()
    else:
        delivery.status = "received"
    db.commit()

    with pytest.raises(HTTPException) as exc:
        receive_event(
            "hidden_oasis_staff_payroll", event,
            x_integration_api_key="alpha", db=db,
        )

    assert exc.value.status_code == 409
    assert "reconcile" in str(exc.value.detail)
    assert db.query(IntegrationDelivery).count() == 1
    assert db.query(models.ExternalReviewItem).count() == (0 if missing_link == "review" else 1)
    assert db.query(IntegrationEventInbox).count() == (0 if missing_link == "inbox" else 1)
    db.close()


def test_v2_replay_preserves_human_review_decision(monkeypatch):
    configure_source_keys(monkeypatch)
    db = make_session()
    event = staff_event(event_id="evt-v2-human-reviewed")
    first = receive_event(
        "hidden_oasis_staff_payroll", event,
        x_integration_api_key="alpha", db=db,
    )
    review = db.query(models.ExternalReviewItem).one()
    review.status = "Seen"
    db.commit()

    replay = receive_event(
        "hidden_oasis_staff_payroll", event,
        x_integration_api_key="alpha", db=db,
    )
    assert replay == {"status": "already_applied", "delivery_id": first["delivery_id"]}
    assert db.query(models.ExternalReviewItem).one().status == "Seen"
    assert db.query(models.ExternalReviewItem).count() == 1
    db.close()
