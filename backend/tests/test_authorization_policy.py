import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.authorization_policy import Action, authorize_action, scope_query
from app.decision_boundary import _decision_from_request
from app.routers.authorized_crud import (
    add_comment_authorized,
    create_resource_authorized,
    update_resource_authorized,
)
from app.routers.api import CommentPayload


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


def seed_scope(db):
    front = models.Department(name="Front Desk", short_name="FRON")
    marketing = models.Department(name="Marketing", short_name="MARK")
    db.add_all([front, marketing])
    db.flush()

    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    admin = models.User(name="Admin", role="admin", department_id=front.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=front.id, is_active=True)
    lead = models.User(name="Lead", role="lead", department_id=front.id, is_active=True)
    staff = models.User(name="Staff", role="staff", department_id=front.id, is_active=True)
    other_staff = models.User(name="Other Staff", role="staff", department_id=marketing.id, is_active=True)
    db.add_all([owner, admin, manager, lead, staff, other_staff])
    db.flush()
    for user, department in ((manager, front), (lead, front), (staff, front), (other_staff, marketing)):
        db.add(models.UserDepartment(user_id=user.id, department_id=department.id, is_primary=True))
    db.commit()
    return front, marketing, owner, admin, manager, lead, staff, other_staff


def expect_http(status, fn):
    with pytest.raises(HTTPException) as exc:
        fn()
    assert exc.value.status_code == status
    return exc.value


def test_staff_cannot_create_generic_department_task(db):
    front, _, _, _, _, _, staff, _ = seed_scope(db)
    before = db.query(models.Task).count()
    expect_http(
        403,
        lambda: create_resource_authorized(
            "tasks", {"title": "Unauthorized", "department_id": front.id}, staff, db
        ),
    )
    assert db.query(models.Task).count() == before


def test_staff_cannot_edit_department_record(db):
    front, _, _, _, _, _, staff, _ = seed_scope(db)
    task = models.Task(title="Existing", department_id=front.id)
    db.add(task)
    db.commit()
    expect_http(
        403,
        lambda: update_resource_authorized("tasks", task.id, {"title": "Spoofed"}, staff, db),
    )
    db.refresh(task)
    assert task.title == "Existing"


def test_manager_cannot_mutate_unrelated_department_without_membership(db):
    _, marketing, _, _, manager, _, _, _ = seed_scope(db)
    task = models.Task(title="Marketing", department_id=marketing.id)
    db.add(task)
    db.commit()
    expect_http(
        403,
        lambda: update_resource_authorized("tasks", task.id, {"title": "Bypass"}, manager, db),
    )
    db.refresh(task)
    assert task.title == "Marketing"


def test_non_executive_cannot_create_null_department_record(db):
    _, _, _, _, _, lead, _, _ = seed_scope(db)
    expect_http(
        403,
        lambda: create_resource_authorized("tasks", {"title": "Unscoped"}, lead, db),
    )


def test_owner_and_admin_keep_department_management_authority(db):
    front, _, owner, admin, _, _, _, _ = seed_scope(db)
    owner_task = create_resource_authorized("tasks", {"title": "Owner", "department_id": front.id}, owner, db)
    admin_task = create_resource_authorized("tasks", {"title": "Admin", "department_id": front.id}, admin, db)
    assert owner_task["title"] == "Owner"
    assert admin_task["title"] == "Admin"


def test_generic_approval_mutations_are_workflow_owned(db):
    front, _, owner, _, _, lead, _, _ = seed_scope(db)
    approval = models.Approval(title="Pending", department_id=front.id, status="Pending")
    db.add(approval)
    db.commit()
    expect_http(
        405,
        lambda: update_resource_authorized("approvals", approval.id, {"status": "Approved"}, lead, db),
    )
    db.refresh(approval)
    assert approval.status == "Pending"
    expect_http(
        405,
        lambda: update_resource_authorized("approvals", approval.id, {"status": "Approved"}, owner, db),
    )


def test_generic_approval_status_is_not_preempted_by_decision_middleware():
    assert not _decision_from_request(
        "POST",
        "/api/approvals/123/status",
        "application/json",
        b'{"status":"Approved"}',
    )
    assert _decision_from_request(
        "POST",
        "/api/fixes/123/status",
        "application/json",
        b'{"status":"Verified"}',
    )


def test_external_review_and_submission_generic_writes_return_405(db):
    _, _, owner, _, _, _, _, _ = seed_scope(db)
    expect_http(
        405,
        lambda: create_resource_authorized(
            "external-review-items",
            {
                "external_source": "audit",
                "external_id": "1",
                "event_type": "audit.test",
                "source_app": "audit",
                "title": "Forged",
            },
            owner,
            db,
        ),
    )
    expect_http(
        405,
        lambda: create_resource_authorized("submissions", {"title": "Forged"}, owner, db),
    )


def test_client_supplied_audit_identity_is_rejected(db):
    front, _, owner, _, _, _, _, other_staff = seed_scope(db)
    expect_http(
        400,
        lambda: create_resource_authorized(
            "requests",
            {
                "title": "Spoof",
                "department_id": front.id,
                "requested_by_id": other_staff.id,
            },
            owner,
            db,
        ),
    )


def test_comment_author_is_authenticated_user_not_browser_value(db):
    front, _, owner, _, _, _, _, other_staff = seed_scope(db)
    task = models.Task(title="Comment target", department_id=front.id)
    db.add(task)
    db.commit()
    result = add_comment_authorized(
        "tasks",
        task.id,
        CommentPayload(body="hello", author_id=other_staff.id),
        owner,
        db,
    )
    assert result["author_id"] == owner.id


def test_scope_query_excludes_other_and_null_departments_for_lead(db):
    front, marketing, _, _, _, lead, _, _ = seed_scope(db)
    db.add_all(
        [
            models.Task(title="Front", department_id=front.id),
            models.Task(title="Marketing", department_id=marketing.id),
            models.Task(title="Null", department_id=None),
        ]
    )
    db.commit()
    rows = scope_query(db, lead, models.Task, db.query(models.Task)).all()
    assert [row.title for row in rows] == ["Front"]


def test_decide_capability_is_separate_from_generic_mutation(db):
    front, _, owner, _, manager, lead, _, _ = seed_scope(db)
    approval = models.Approval(title="Pending", department_id=front.id, status="Pending")
    db.add(approval)
    db.commit()
    authorize_action(db, owner, "approvals", Action.DECIDE, obj=approval)
    authorize_action(db, manager, "approvals", Action.DECIDE, obj=approval)
    expect_http(403, lambda: authorize_action(db, lead, "approvals", Action.DECIDE, obj=approval))
