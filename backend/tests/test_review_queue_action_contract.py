"""Review queue status contract matches actionable canonical workflows."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.review import review_queue
from app.services.submission_workflow import decide_submission


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front = models.Department(name="Front Office")
    marketing = models.Department(name="Marketing")
    db.add_all([front, marketing])
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=front.id, is_active=True)
    staff = models.User(name="Staff", role="staff", department_id=front.id, is_active=True)
    db.add_all([owner, manager, staff])
    db.flush()
    for user in (manager, staff):
        db.add(models.UserDepartment(user_id=user.id, department_id=front.id, is_primary=True))
    db.commit()
    try:
        yield db, front, marketing, owner, manager, staff
    finally:
        db.close()
        engine.dispose()


def add_submission(db, department, title, status="New", requires_review=True, hidden=False):
    obj = models.Submission(
        title=title,
        department_id=department.id,
        review_status=status,
        requires_review=requires_review,
        hidden_from_active=hidden,
    )
    db.add(obj)
    db.commit()
    return obj


def test_review_queue_excludes_items_not_requiring_decision_and_terminal_items(context):
    db, front, _, _, manager, _ = context
    add_submission(db, front, "New needing review")
    add_submission(db, front, "In review", "Review")
    add_submission(db, front, "Bypass review", "New", requires_review=False)
    add_submission(db, front, "Bypass review in progress", "Review", requires_review=False)
    add_submission(db, front, "Already accepted", "Accepted")
    add_submission(db, front, "Archived new", hidden=True)
    queue = review_queue(department_id=None, user=manager, db=db)
    assert {item["title"] for item in queue["submissions"]} == {
        "New needing review", "In review",
    }


@pytest.mark.parametrize("status", ["New", "Review"])
def test_both_pending_queue_submission_states_can_be_decided_once(context, status):
    db, front, _, _, manager, _ = context
    submission = add_submission(db, front, "Ready", status=status)
    row = decide_submission(db, manager, submission.id, "Accepted", "Checked")
    assert row.review_status == "Accepted"
    assert row.reviewed_by_id == manager.id
    assert row.reviewed_at is not None
    with pytest.raises(HTTPException) as exc:
        decide_submission(db, manager, submission.id, "Rejected", "Again")
    assert exc.value.status_code == 409
    db.refresh(submission)
    assert submission.review_status == "Accepted"
    assert review_queue(department_id=None, user=manager, db=db)["submissions"] == []


def test_manager_cannot_decide_foreign_department_review_submission(context):
    db, front, marketing, _, manager, _ = context
    foreign = add_submission(db, marketing, "Foreign", "Review")
    with pytest.raises(HTTPException) as exc:
        decide_submission(db, manager, foreign.id, "Accepted", None)
    assert exc.value.status_code == 403
    db.commit()
    db.refresh(foreign)
    assert foreign.review_status == "Review"
    assert db.query(models.ActivityLog).count() == 0


def test_staff_cannot_decide_review_state(context):
    db, front, _, _, _, staff = context
    submission = add_submission(db, front, "Staff cannot decide", "Review")
    with pytest.raises(HTTPException) as exc:
        decide_submission(db, staff, submission.id, "Accepted", None)
    assert exc.value.status_code == 403
    db.refresh(submission)
    assert submission.review_status == "Review"


def test_queue_respects_nonexecutive_department_scope(context):
    db, front, marketing, owner, _, staff = context
    add_submission(db, front, "Front")
    add_submission(db, marketing, "Marketing", "Review")
    assert {row["title"] for row in review_queue(department_id=None, user=staff, db=db)["submissions"]} == {"Front"}
    assert {row["title"] for row in review_queue(department_id=None, user=owner, db=db)["submissions"]} == {"Front", "Marketing"}
