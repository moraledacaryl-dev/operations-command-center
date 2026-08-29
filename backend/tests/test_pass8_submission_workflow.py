import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.workflow import SubmissionDecisionCommand
from app.services.submission_workflow import decide_submission


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def seed(db):
    department = models.Department(name="Front Office")
    db.add(department)
    db.flush()

    manager = models.User(name="Manager", email="manager@example.test", role="manager", department_id=department.id, is_active=True)
    staff = models.User(name="Staff", email="staff@example.test", role="staff", department_id=department.id, is_active=True)
    db.add_all([manager, staff])
    db.flush()
    db.add_all([
        models.UserDepartment(user_id=manager.id, department_id=department.id, is_primary=True),
        models.UserDepartment(user_id=staff.id, department_id=department.id, is_primary=True),
    ])
    submission = models.Submission(title="Inbox item", department_id=department.id, review_status="New", requires_review=True)
    db.add(submission)
    db.commit()
    return department, manager, staff, submission


def test_submission_command_is_strict():
    with pytest.raises(ValidationError):
        SubmissionDecisionCommand(status="Accepted", unexpected=True)


def test_authorized_manager_can_decide_once(db):
    _, manager, _, submission = seed(db)
    decided = decide_submission(db, manager, submission.id, "Accepted", "Reviewed")
    assert decided.review_status == "Accepted"
    assert decided.reviewed_by_id == manager.id
    assert decided.reviewed_at is not None
    assert decided.note == "Reviewed"

    with pytest.raises(HTTPException) as exc:
        decide_submission(db, manager, submission.id, "Rejected", "Changed mind")
    assert exc.value.status_code == 409


def test_rejection_requires_note(db):
    _, manager, _, submission = seed(db)
    with pytest.raises(HTTPException) as exc:
        decide_submission(db, manager, submission.id, "Rejected", "")
    assert exc.value.status_code == 400


def test_staff_cannot_decide_submission(db):
    _, _, staff, submission = seed(db)
    with pytest.raises(HTTPException) as exc:
        decide_submission(db, staff, submission.id, "Accepted", None)
    assert exc.value.status_code == 403
