"""Production-safe integration audit: four-source coverage, linkage and privacy."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.foundation_models import IntegrationEventInbox
from app.integration_models import IntegrationDelivery
from app.models import ExternalReviewItem
from scripts.audit_integration_deliveries import audit_delivery_integrity


NOW = datetime(2026, 10, 22, 0, 0, tzinfo=timezone.utc)


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


def add_delivery(
    db, *, source="hidden_oasis_staff_payroll", event_id="staff:001",
    days_ago=0, with_inbox=True, with_review=True, status="processed",
):
    received = NOW - timedelta(days=days_ago)
    db.add(IntegrationDelivery(
        source_app=source, event_id=event_id, event_type="example.event",
        status=status, payload_sha256="a" * 64, received_at=received,
        processed_at=received if status == "processed" else None,
    ))
    if with_inbox:
        db.add(IntegrationEventInbox(
            source_app=source, external_event_id=event_id,
            event_type="example.event", payload_json="{}",
            received_at=received, processed_at=received, attempts=1,
        ))
    if with_review:
        db.add(ExternalReviewItem(
            external_source=source, external_id=event_id,
            source_app=source, event_type="example.event",
            title="Sensitive internal information NOT for reporting",
            payload_json='{"secret":"NOT_FOR_REPORT"}',
            status="For Review",
        ))
    db.commit()


def test_empty_audit_reports_missing_evidence_without_claiming_integrations_are_live(db):
    report = audit_delivery_integrity(db, now=NOW)
    assert report["read_only"] is True
    assert report["structural_integrity"] == "pass"
    assert report["all_sources_observed_recently"] is False
    assert len(report["sources"]) == 4
    assert {item["delivery_observation"] for item in report["sources"].values()} == {"not_observed"}
    assert report["totals"]["observed_recent_v2"] == 0
    assert not db.new and not db.dirty


def test_successful_delivery_counts_and_corresponding_links(db):
    add_delivery(db)
    report = audit_delivery_integrity(db, now=NOW)
    staff = report["sources"]["hidden_oasis_staff_payroll"]
    assert staff["delivery_observation"] == "recent_event_observed"
    assert staff["all_time_v2_deliveries"] == 1
    assert staff["recent_v2_deliveries"] == 1
    assert staff["missing_review"] == staff["missing_inbox"] == 0
    assert staff["unprocessed_deliveries"] == 0
    assert report["structural_integrity"] == "pass"
    assert "NOT_FOR_REPORT" not in str(report)
    assert "Sensitive internal information" not in str(report)
    assert "staff:001" not in str(report)


def test_missing_review_and_inbox_and_unprocessed_are_flagged(db):
    add_delivery(db, with_review=False, with_inbox=False, status="received")
    report = audit_delivery_integrity(db, now=NOW)
    assert report["structural_integrity"] == "investigate"
    assert report["totals"]["missing_review"] == 1
    assert report["totals"]["missing_inbox"] == 1
    assert report["totals"]["unprocessed_deliveries"] == 1
    assert db.query(IntegrationDelivery).count() == 1
    assert db.query(ExternalReviewItem).count() == 0


def test_stale_v2_event_is_not_misrepresented_as_recent(db):
    add_delivery(db, days_ago=14)
    report = audit_delivery_integrity(db, now=NOW, hours=168)
    staff = report["sources"]["hidden_oasis_staff_payroll"]
    assert staff["delivery_observation"] == "no_recent_event"
    assert staff["all_time_v2_deliveries"] == 1
    assert staff["recent_v2_deliveries"] == 0
    assert report["all_sources_observed_recently"] is False


def test_legacy_only_review_record_is_not_flagged_as_missing_v2_link(db):
    db.add(ExternalReviewItem(
        external_source="accounting_program", external_id="legacy:2025:1",
        source_app="accounting_program",
        event_type="payroll_import.pending_review", title="Legacy accounting",
        status="Seen", payload_json="{}",
    ))
    db.commit()
    report = audit_delivery_integrity(db, now=NOW)
    accounting = report["sources"]["accounting_program"]
    assert accounting["legacy_review_records"] == 1
    assert accounting["all_time_v2_deliveries"] == 0
    assert accounting["missing_review"] == 0
    assert report["structural_integrity"] == "pass"


def test_all_four_sources_only_pass_recent_evidence_when_each_delivers(db):
    sources = (
        "hidden_oasis_staff_payroll", "accounting_program",
        "dedicated_pos_cloud", "inventory_procurement",
    )
    for source in sources:
        add_delivery(db, source=source, event_id=f"test-{source}")
    report = audit_delivery_integrity(db, now=NOW)
    assert report["all_sources_observed_recently"] is True
    assert report["totals"]["observed_recent_v2"] == 4


def test_invalid_hours_does_not_query_or_mutate_database(db):
    with pytest.raises(ValueError, match="hours"):
        audit_delivery_integrity(db, now=NOW, hours=0)
    assert not db.new and not db.dirty


def test_opt_in_diagnostics_expose_exact_orphans_and_only_candidate_review_ids(db):
    add_delivery(db, event_id="staff:diagnostic", with_review=False)
    delivery = db.query(IntegrationDelivery).one()
    delivery.subject_type = "task"
    delivery.subject_id = "42"
    db.add(ExternalReviewItem(
        external_source="historical_source_alias",
        external_id="staff:diagnostic",
        source_app="hidden_oasis_staff_payroll",
        source_record_type="task",
        source_record_id="42",
        event_type="example.event",
        title="PRIVATE guest narrative",
        payload_json='{"bank_account":"PRIVATE ACCOUNT"}',
        status="Seen",
    ))
    db.commit()
    alternate_id = db.query(ExternalReviewItem).one().id

    standard = audit_delivery_integrity(db, now=NOW)
    assert "diagnostics" not in standard

    report = audit_delivery_integrity(db, now=NOW, diagnostic_limit=10)
    assert report["read_only"] is True
    assert report["totals"]["missing_review"] == 1
    assert report["diagnostics"]["truncated"] is False
    assert report["diagnostics"]["candidates_are_not_verified_links"] is True
    assert len(report["diagnostics"]["deliveries"]) == 1
    row = report["diagnostics"]["deliveries"][0]
    assert row["delivery_id"] == delivery.id
    assert row["source_app"] == "hidden_oasis_staff_payroll"
    assert row["event_id"] == "staff:diagnostic"
    assert row["inbox_id"] is not None
    assert row["review_id"] is None
    assert row["candidate_review_ids_same_event_id"] == [alternate_id]
    assert row["candidate_review_ids_same_subject"] == [alternate_id]
    assert "PRIVATE" not in str(report)
    assert db.query(ExternalReviewItem).one().status == "Seen"
    assert not db.new and not db.dirty


def test_diagnostic_limit_reports_truncation_without_changing_counts(db):
    add_delivery(db, event_id="staff:one", with_review=False, with_inbox=False)
    add_delivery(db, event_id="staff:two", with_review=False)
    report = audit_delivery_integrity(db, now=NOW, diagnostic_limit=1)
    assert report["totals"]["missing_review"] == 2
    assert report["totals"]["missing_inbox"] == 1
    assert report["diagnostics"]["limit"] == 1
    assert report["diagnostics"]["truncated"] is True
    assert len(report["diagnostics"]["deliveries"]) == 1


def test_negative_diagnostic_limit_rejected_before_database_access(db):
    with pytest.raises(ValueError, match="diagnostic_limit"):
        audit_delivery_integrity(db, now=NOW, diagnostic_limit=-1)
    assert not db.new and not db.dirty
