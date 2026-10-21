"""Comment mentions cannot disclose a restricted parent record across departments."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import foundation_models as foundation
from app import models
from app.routers.authorized_crud import CommentPayload, add_comment_authorized
from app.services.notifications import create_mentions


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front = models.Department(name="Reception")
    maintenance = models.Department(name="Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    lead = models.User(name="Front Lead", role="lead", department_id=front.id, is_active=True)
    colleague = models.User(name="Front Colleague", email="front@example.com",
                            role="staff", department_id=front.id, is_active=True)
    outsider = models.User(name="Maintenance Colleague", email="maintenance@example.com",
                          role="staff", department_id=maintenance.id, is_active=True)
    manager = models.User(name="Management Reviewer", role="manager",
                          department_id=maintenance.id, is_active=True)
    inactive = models.User(name="Inactive Colleague", role="staff",
                           department_id=front.id, is_active=False)
    db.add_all([owner, lead, colleague, outsider, manager, inactive])
    db.flush()
    for person, dept in ((lead, front), (colleague, front), (outsider, maintenance), (manager, maintenance), (inactive, front)):
        db.add(models.UserDepartment(user_id=person.id, department_id=dept.id, is_primary=True))
    project = models.Project(title="Private room turnover", department_id=front.id)
    task = models.Task(title="Private guest task", department_id=front.id)
    db.add_all([project, task])
    db.commit()
    try:
        yield db, front, maintenance, owner, lead, colleague, outsider, manager, inactive, project, task
    finally:
        db.close()
        engine.dispose()


def mentioned_ids(db):
    return {row.mentioned_user_id for row in db.query(foundation.Mention).all()}


def notified_ids(db):
    return {row.user_id for row in db.query(foundation.Notification).all()}


def test_unauthorized_department_mention_is_not_stored_or_notified(context):
    db, _, _, _, lead, colleague, outsider, _, _, project, _ = context
    body = "Guest privacy details @[Maintenance Colleague] and @[Front Colleague]"
    add_comment_authorized("projects", project.id,
                           CommentPayload(body=body, comment_type="Question"), user=lead, db=db)
    assert mentioned_ids(db) == {colleague.id}
    assert notified_ids(db) == {colleague.id}
    assert db.query(models.Comment).one().body == body
    assert all("Guest privacy details" in row.body for row in db.query(foundation.Notification).all())


def test_email_mention_cannot_bypass_parent_department_visibility(context):
    db, _, _, owner, _, colleague, outsider, _, _, _, task = context
    add_comment_authorized(
        "tasks", task.id,
        CommentPayload(body="Restricted details @maintenance@example.com and @front@example.com"),
        user=owner, db=db,
    )
    assert mentioned_ids(db) == {colleague.id}
    assert notified_ids(db) == {colleague.id}
    assert outsider.id not in notified_ids(db)


def test_legitimate_global_read_role_can_receive_cross_department_mention(context):
    db, _, _, _, lead, _, outsider, manager, _, project, _ = context
    add_comment_authorized(
        "projects", project.id,
        CommentPayload(body="Review this @[Management Reviewer] and @[Maintenance Colleague]"),
        user=lead, db=db,
    )
    assert mentioned_ids(db) == {manager.id}
    assert notified_ids(db) == {manager.id}
    assert outsider.id not in mentioned_ids(db)


def test_secondary_department_membership_allows_and_revocation_removes_mention(context):
    db, front, _, _, lead, _, outsider, _, _, project, _ = context
    membership = models.UserDepartment(
        user_id=outsider.id, department_id=front.id, is_primary=False,
    )
    db.add(membership)
    db.commit()
    add_comment_authorized(
        "projects", project.id,
        CommentPayload(body="First @[Maintenance Colleague]"),
        user=lead, db=db,
    )
    assert mentioned_ids(db) == {outsider.id}
    db.query(foundation.Mention).delete()
    db.query(foundation.Notification).delete()
    db.delete(membership)
    db.commit()
    add_comment_authorized(
        "projects", project.id,
        CommentPayload(body="Second @[Maintenance Colleague]"),
        user=lead, db=db,
    )
    assert mentioned_ids(db) == set()
    assert notified_ids(db) == set()


def test_self_inactive_or_unknown_mentions_are_skipped(context):
    db, _, _, _, lead, _, _, _, inactive, project, _ = context
    add_comment_authorized(
        "projects", project.id,
        CommentPayload(body="@[Front Lead] @[Inactive Colleague] @[Imaginary Person]"),
        user=lead, db=db,
    )
    assert mentioned_ids(db) == set()
    assert notified_ids(db) == set()


def test_unrecognized_or_deleted_parent_does_not_create_mention_side_channel(context):
    db, _, _, _, lead, colleague, _, _, _, _, task = context
    assert create_mentions(
        db, "@[Front Colleague]", mentioned_by_id=lead.id,
        parent_type="unrecognized", parent_id=task.id,
    ) == []
    assert create_mentions(
        db, "@[Front Colleague]", mentioned_by_id=lead.id,
        parent_type="tasks", parent_id=999999,
    ) == []
    db.commit()
    assert mentioned_ids(db) == set()
    assert notified_ids(db) == set()


def test_authorized_records_keep_full_existing_mention_behavior(context):
    db, _, _, _, lead, colleague, _, _, _, project, task = context
    add_comment_authorized(
        "projects", project.id,
        CommentPayload(body="Please confirm @[Front Colleague]"),
        user=lead, db=db,
    )
    add_comment_authorized(
        "tasks", task.id,
        CommentPayload(body="Please review @front@example.com"),
        user=lead, db=db,
    )
    entries = db.query(foundation.Mention).order_by(foundation.Mention.id).all()
    assert len(entries) == 2
    assert {entry.parent_type for entry in entries} == {"projects", "tasks"}
    assert all(entry.mentioned_user_id == colleague.id for entry in entries)
    assert db.query(foundation.Notification).count() == 2
