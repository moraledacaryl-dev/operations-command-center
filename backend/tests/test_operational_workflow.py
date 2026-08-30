import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.operational_workflow import allowed_actions_for, transition_operational


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    department = models.Department(name="Operations")
    session.add(department)
    session.flush()
    owner = models.User(name="Owner", email="owner@example.com", role="owner", department_id=department.id, is_active=True)
    session.add(owner)
    session.commit()
    try:
        yield session, owner, department
    finally:
        session.close()


@pytest.mark.parametrize(
    ("model", "resource", "initial", "actions", "terminal"),
    [
        (models.Task, "tasks", "To Do", ["start", "submit-review", "complete"], "Done"),
        (models.Project, "projects", "Planned", ["start", "complete"], "Done"),
        (models.Post, "posts", "Idea", ["start-draft", "submit-review", "approve", "schedule", "publish"], "Posted"),
        (models.GuestNote, "guests", "Open", ["follow-up", "resolve-follow"], "Done"),
        (models.ShiftNote, "shift-notes", "New", ["acknowledge", "resolve-seen"], "Done"),
    ],
)
def test_canonical_happy_paths(context, model, resource, initial, actions, terminal):
    db, owner, department = context
    item = model(title=f"{resource} item", status=initial, department_id=department.id)
    if resource == "posts":
        item.platform = "Instagram"
        item.content_type = "Reel"
    db.add(item)
    db.commit()

    for action in actions:
        item = transition_operational(db, owner, resource, item.id, action)
    assert item.status == terminal
    assert item.completed_at is not None
    assert allowed_actions_for(db, owner, resource, item)


def test_wrong_source_state_is_a_conflict(context):
    db, owner, department = context
    project = models.Project(title="Launch", status="Planned", department_id=department.id)
    db.add(project)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        transition_operational(db, owner, "projects", project.id, "complete")
    assert exc.value.status_code == 409


def test_required_transition_reason_is_enforced(context):
    db, owner, department = context
    post = models.Post(title="Campaign", status="Review", platform="Instagram", content_type="Reel", department_id=department.id)
    db.add(post)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        transition_operational(db, owner, "posts", post.id, "request-revision")
    assert exc.value.status_code == 400
    updated = transition_operational(db, owner, "posts", post.id, "request-revision", "Use the approved brand asset")
    assert updated.status == "Fix"


def test_shift_acknowledgement_is_attributed(context):
    db, owner, department = context
    shift = models.ShiftNote(title="Handover", status="New", department_id=department.id)
    db.add(shift)
    db.commit()

    updated = transition_operational(db, owner, "shift-notes", shift.id, "acknowledge")
    assert updated.seen_by_id == owner.id
    assert updated.seen_at is not None
