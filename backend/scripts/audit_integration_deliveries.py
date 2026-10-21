"""Read-only cross-app delivery audit; no event replay, secrets, or mutations.

Run after a gated deployment with the protected Operations environment loaded.
This reports *observed deliveries*, not inferred producer health.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

from app.clock import as_utc, utc_now
from app.foundation_models import IntegrationEventInbox
from app.integration_models import IntegrationDelivery
from app.models import ExternalReviewItem
from app.routers.integrations_v2 import SOURCE_EVENT_TYPES


def audit_delivery_integrity(
    db: Session, *, now: datetime | None = None, hours: int = 168
) -> dict[str, Any]:
    if hours < 1:
        raise ValueError("hours must be at least 1")

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
    args = parser.parse_args()
    if args.hours < 1:
        parser.error("--hours must be >= 1")

    from app.database import SessionLocal

    with SessionLocal() as db:
        # Production PostgreSQL blocks accidental writes at the transaction
        # level; the audit itself contains only SELECT queries.
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SET TRANSACTION READ ONLY"))
        report = audit_delivery_integrity(db, hours=args.hours)
        db.rollback()

    print(json.dumps(report, indent=2, sort_keys=True))
    if report["structural_integrity"] != "pass":
        return 2
    if args.require_all_sources and not report["all_sources_observed_recently"]:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
