"""Read-only cross-app delivery audit; no event replay, secrets, or mutations.

Run after a gated deployment with the protected Operations environment loaded.
This reports *observed deliveries*, not inferred producer health.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

from app.clock import as_utc, utc_now
from app.foundation_models import IntegrationEventInbox
from app.integration_models import IntegrationDelivery
from app.models import ExternalReviewItem
from app.routers.integrations_v2 import SOURCE_EVENT_TYPES, _source_keys

# A filename-style event identity is an investigation hint, never permission
# to delete records or exempt a missing Review from integrity checks.
CONNECTIVITY_CERT_ID = re.compile(
    r"^connectivity-cert-\d{8}T\d{6}Z-\d+-(staff|accounting|pos|inventory)$"
)
CERT_SOURCE_SUFFIX = {
    "hidden_oasis_staff_payroll": "staff",
    "accounting_program": "accounting",
    "dedicated_pos_cloud": "pos",
    "inventory_procurement": "inventory",
}


def _identity_hint(source_app: str, event_id: str) -> str:
    match = CONNECTIVITY_CERT_ID.fullmatch(event_id)
    if match and match.group(1) == CERT_SOURCE_SUFFIX.get(source_app):
        return "suspected_connectivity_test"
    return "unclassified"


def audit_receiver_configuration() -> dict[str, Any]:
    """Report only presence/validity, never values of receiver credentials.

    This checks the Operations receiver configuration, NOT whether a producer
    possesses the same key or has an active sending worker.
    """
    try:
        configured = _source_keys()
    except HTTPException:
        return {
            "configuration_valid": False,
            "configured_sources": {source: False for source in sorted(SOURCE_EVENT_TYPES)},
            "all_sources_configured": False,
            "reason": "Receiver credential configuration was rejected; inspect protected environment",
        }
    source_presence = {
        source: bool(configured.get(source)) for source in sorted(SOURCE_EVENT_TYPES)
    }
    return {
        "configuration_valid": True,
        "configured_sources": source_presence,
        "all_sources_configured": all(source_presence.values()),
        "reason": "Presence only; does not verify producer credentials or outbound traffic",
    }


def audit_delivery_integrity(
    db: Session, *, now: datetime | None = None, hours: int = 168,
    diagnostic_limit: int = 0,
) -> dict[str, Any]:
    if hours < 1:
        raise ValueError("hours must be at least 1")
    if diagnostic_limit < 0:
        raise ValueError("diagnostic_limit must be nonnegative")

    now = as_utc(now or utc_now())
    cutoff = now - timedelta(hours=hours)
    report: dict[str, Any] = {
        "read_only": True,
        "window_hours": hours,
        "as_of_utc": now.isoformat(),
        "sources": {},
        "totals": {
            "observed_recent_v2": 0,
            "missing_review": 0,
            "missing_inbox": 0,
            "unprocessed_deliveries": 0,
        },
    }

    delivery_to_review = and_(
        ExternalReviewItem.external_source == IntegrationDelivery.source_app,
        ExternalReviewItem.external_id == IntegrationDelivery.event_id,
    )
    delivery_to_inbox = and_(
        IntegrationEventInbox.source_app == IntegrationDelivery.source_app,
        IntegrationEventInbox.external_event_id == IntegrationDelivery.event_id,
    )
    for source in sorted(SOURCE_EVENT_TYPES):
        common = (IntegrationDelivery.source_app == source,)
        total, newest = (
            db.query(
                func.count(IntegrationDelivery.id),
                func.max(IntegrationDelivery.received_at),
            )
            .filter(*common)
            .one()
        )
        recent = (
            db.query(func.count(IntegrationDelivery.id))
            .filter(*common, IntegrationDelivery.received_at >= cutoff)
            .scalar()
            or 0
        )
        missing_review = (
            db.query(func.count(IntegrationDelivery.id))
            .outerjoin(ExternalReviewItem, delivery_to_review)
            .filter(*common, ExternalReviewItem.id.is_(None))
            .scalar()
            or 0
        )
        missing_inbox = (
            db.query(func.count(IntegrationDelivery.id))
            .outerjoin(IntegrationEventInbox, delivery_to_inbox)
            .filter(*common, IntegrationEventInbox.id.is_(None))
            .scalar()
            or 0
        )
        unprocessed = (
            db.query(func.count(IntegrationDelivery.id))
            .filter(*common, IntegrationDelivery.status != "processed")
            .scalar()
            or 0
        )
        # Legacy events have an ExternalReviewItem but no v2 IntegrationDelivery.
        # They are counted as legacy traffic, not mislabeled as broken v2 links.
        legacy_only = (
            db.query(func.count(ExternalReviewItem.id))
            .outerjoin(
                IntegrationDelivery,
                and_(
                    IntegrationDelivery.source_app == ExternalReviewItem.external_source,
                    IntegrationDelivery.event_id == ExternalReviewItem.external_id,
                ),
            )
            .filter(
                ExternalReviewItem.external_source == source,
                IntegrationDelivery.id.is_(None),
            )
            .scalar()
            or 0
        )
        newest_utc = as_utc(newest) if newest is not None else None
        state = (
            "not_observed"
            if newest_utc is None
            else "recent_event_observed"
            if newest_utc >= cutoff
            else "no_recent_event"
        )
        report["sources"][source] = {
            "delivery_observation": state,
            "latest_v2_delivery_utc": newest_utc.isoformat() if newest_utc else None,
            "all_time_v2_deliveries": int(total),
            "recent_v2_deliveries": int(recent),
            "legacy_review_records": int(legacy_only),
            "missing_review": int(missing_review),
            "missing_inbox": int(missing_inbox),
            "unprocessed_deliveries": int(unprocessed),
        }
        for name, n in (
            ("observed_recent_v2", recent),
            ("missing_review", missing_review),
            ("missing_inbox", missing_inbox),
            ("unprocessed_deliveries", unprocessed),
        ):
            report["totals"][name] += int(n)

    if diagnostic_limit:
        # An explicit opt-in exposes event identifiers and record IDs only.
        # No guest, payroll, financial, or other event payload is included.
        problem_deliveries = (
            db.query(
                IntegrationDelivery,
                IntegrationEventInbox.id,
                ExternalReviewItem.id,
            )
            .outerjoin(IntegrationEventInbox, delivery_to_inbox)
            .outerjoin(ExternalReviewItem, delivery_to_review)
            .filter(
                IntegrationDelivery.source_app.in_(tuple(SOURCE_EVENT_TYPES)),
                or_(
                    IntegrationEventInbox.id.is_(None),
                    ExternalReviewItem.id.is_(None),
                    IntegrationDelivery.status != "processed",
                ),
            )
            .order_by(IntegrationDelivery.source_app, IntegrationDelivery.id)
            .limit(diagnostic_limit + 1)
            .all()
        )
        details = []
        for delivery, inbox_id, review_id in problem_deliveries[:diagnostic_limit]:
            candidate_same_event = []
            candidate_same_subject = []
            if review_id is None:
                # These are leads for a human investigator, not proof of a
                # replacement review. Never relink records from this audit.
                candidate_same_event = [
                    int(row.id)
                    for row in db.query(ExternalReviewItem.id)
                    .filter(ExternalReviewItem.external_id == delivery.event_id)
                    .order_by(ExternalReviewItem.id)
                    .limit(20)
                    .all()
                ]
                if delivery.subject_type and delivery.subject_id:
                    candidate_same_subject = [
                        int(row.id)
                        for row in db.query(ExternalReviewItem.id)
                        .filter(
                            ExternalReviewItem.source_app == delivery.source_app,
                            ExternalReviewItem.source_record_type == delivery.subject_type,
                            ExternalReviewItem.source_record_id == delivery.subject_id,
                        )
                        .order_by(ExternalReviewItem.id)
                        .limit(20)
                        .all()
                    ]
            details.append({
                "delivery_id": int(delivery.id),
                "source_app": delivery.source_app,
                "event_id": delivery.event_id,
                "event_type": delivery.event_type,
                "identity_hint": _identity_hint(delivery.source_app, delivery.event_id),
                "received_at_utc": as_utc(delivery.received_at).isoformat(),
                "status": delivery.status,
                "inbox_id": int(inbox_id) if inbox_id is not None else None,
                "review_id": int(review_id) if review_id is not None else None,
                "candidate_review_ids_same_event_id": candidate_same_event,
                "candidate_review_ids_same_subject": candidate_same_subject,
            })
        report["diagnostics"] = {
            "limit": diagnostic_limit,
            "truncated": len(problem_deliveries) > diagnostic_limit,
            "deliveries": details,
            "candidates_are_not_verified_links": True,
        }

    report["structural_integrity"] = (
        "pass"
        if not any(
            report["totals"][name]
            for name in ("missing_review", "missing_inbox", "unprocessed_deliveries")
        )
        else "investigate"
    )
    report["all_sources_observed_recently"] = all(
        item["delivery_observation"] == "recent_event_observed"
        for item in report["sources"].values()
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only source delivery and Review-link audit; no secrets printed."
    )
    parser.add_argument("--hours", type=int, default=168)
    parser.add_argument(
        "--require-all-sources",
        action="store_true",
        help="Fail when any source has no v2 deliveries within the selected window.",
    )
    parser.add_argument(
        "--receiver-credentials",
        action="store_true",
        help="Opt in to receiver key presence/validity flags; never prints secrets.",
    )
    parser.add_argument(
        "--diagnostic-limit",
        type=int,
        default=0,
        help="Opt in to up to N incomplete delivery IDs and candidate Review IDs (no payloads).",
    )
    args = parser.parse_args()
    if args.hours < 1:
        parser.error("--hours must be >= 1")
    if args.diagnostic_limit < 0:
        parser.error("--diagnostic-limit must be >= 0")

    from app.database import SessionLocal

    with SessionLocal() as db:
        # Production PostgreSQL blocks accidental writes at the transaction
        # level; the audit itself contains only SELECT queries.
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SET TRANSACTION READ ONLY"))
        report = audit_delivery_integrity(db, hours=args.hours, diagnostic_limit=args.diagnostic_limit)
        db.rollback()

    if args.receiver_credentials:
        report["receiver_configuration"] = audit_receiver_configuration()

    print(json.dumps(report, indent=2, sort_keys=True))
    if report["structural_integrity"] != "pass":
        return 2
    if args.require_all_sources and not report["all_sources_observed_recently"]:
        return 3
    if args.receiver_credentials and not report["receiver_configuration"]["all_sources_configured"]:
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
