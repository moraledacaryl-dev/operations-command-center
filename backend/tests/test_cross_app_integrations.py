import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.routers.api import STAFF_EVENTS, WorkflowPayload, create_approval_from_external_item, mark_external_item_seen, overview_cards, readiness_warnings, reject_external_item, store_external_review_item
from app import models


def make_session():
    engine = create_engine("sqlite:///:memory:", future=True)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    Base.metadata.create_all(bind=engine)
    return TestingSession()


def staff_snapshot(external_id="snap-1"):
    return {
        "external_source": "hidden_oasis_staff_payroll",
        "external_id": external_id,
        "event_type": "staff.operations.snapshot",
        "source_record_type": "Operations Snapshot",
        "source_record_id": None,
        "payload": {
            "counts": {
                "staff_on_duty_today": 8,
                "attendance_exceptions": 1,
                "ot_pending": 2,
                "leave_pending": 3,
                "cash_advance_pending": 1,
                "payroll_qa_warnings": 0,
                "payroll_ready_for_owner_review": 1,
                "annual_reviews_due": 2,
                "memo_acknowledgments_pending": 4,
            },
            "hourly_rate": 999,
        },
    }


def test_staff_events_are_stored_and_deduped_with_sensitive_fields_scrubbed():
    db = make_session()
    first = store_external_review_item(db, staff_snapshot(), STAFF_EVENTS, "hidden_oasis_staff_payroll")
    item = db.get(models.ExternalReviewItem, first["id"])
    item.status = "Seen"
    db.commit()
    second = store_external_review_item(db, staff_snapshot(), STAFF_EVENTS, "hidden_oasis_staff_payroll")
    item = db.query(models.ExternalReviewItem).one()
    assert first["status"] == "accepted"
    assert second["status"] == "already_applied"
    assert item.status == "Seen"
    assert "hourly_rate" not in (item.payload_json or "")


def test_overview_rolls_up_latest_staff_and_pos_context():
    db = make_session()
    store_external_review_item(db, staff_snapshot("snap-2"), STAFF_EVENTS, "hidden_oasis_staff_payroll")
    store_external_review_item(db, {
        "external_source": "dedicated_pos_cloud",
        "external_id": "pos-2026-06-08",
        "event_type": "daily_sales_context",
        "payload": {"totals": {"sales": 1200, "orders": 12}, "counts": {"pending_room_charges": 2}, "drawer_variance": -5},
    }, {"daily_sales_context"}, "dedicated_pos_cloud")
    overview = overview_cards(db)
    assert overview["staff"]["staff_on_duty_today"] == 8
    assert overview["pos"]["sales"] == 1200
    assert overview["pos"]["pending_room_charges"] == 2


def test_external_review_item_can_link_to_task_without_computing_payroll():
    db = make_session()
    dept = models.Department(name="Admin")
    user = models.User(name="Owner", email="owner@test", role="owner", department=dept)
    db.add_all([dept, user])
    db.commit()
    result = store_external_review_item(db, staff_snapshot("snap-3"), STAFF_EVENTS, "hidden_oasis_staff_payroll")
    item = db.get(models.ExternalReviewItem, result["id"])
    task = models.Task(title=item.title, department_id=dept.id, priority=item.priority, note=item.summary)
    db.add(task)
    db.flush()
    item.linked_task_id = task.id
    db.commit()
    assert item.linked_task_id == task.id
    assert not hasattr(models.ExternalReviewItem, "compute_payroll")


def test_external_review_item_actions_mark_seen_reject_and_create_approval():
    db = make_session()
    dept = models.Department(name="Admin")
    user = models.User(name="Owner", email="owner@test", role="owner", department=dept)
    db.add_all([dept, user])
    db.commit()
    result = store_external_review_item(db, staff_snapshot("snap-actions"), STAFF_EVENTS, "hidden_oasis_staff_payroll")
    item = db.get(models.ExternalReviewItem, result["id"])
    item.department_id = dept.id
    db.commit()

    seen = asyncio.run(mark_external_item_seen(item.id, WorkflowPayload(note="Checked"), user=user, db=db))
    assert seen["status"] == "Seen"
    approval_result = asyncio.run(create_approval_from_external_item(item.id, WorkflowPayload(note="Needs owner"), user=user, db=db))
    assert approval_result["approval"]["status"] == "Pending"
    rejected = asyncio.run(reject_external_item(item.id, WorkflowPayload(note="Handled elsewhere"), user=user, db=db))
    assert rejected["status"] == "Rejected"


def test_readiness_warnings_flag_starter_auth_settings():
    warnings = readiness_warnings()
    assert any("SESSION_SECRET" in warning for warning in warnings)
    assert any("COMMAND_CENTER_PASSWORD" in warning for warning in warnings)
