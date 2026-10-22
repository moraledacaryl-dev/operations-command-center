"""Imported review retries must preserve canonical linked-record identity."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.external_review_workflow import create_approval, create_task


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front = models.Department(name="Front Office")
    maintenance = models.Department(name="Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=front.id, is_active=True)
    db.add_all([owner, manager])
    db.flush()
    db.add(models.UserDepartment(user_id=manager.id, department_id=front.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, manager
    finally:
        db.close()
        engine.dispose()


def item_for(db, department, suffix):
    item = models.ExternalReviewItem(
        external_source="accounting_program",
        external_id=f"linked-integrity-{suffix}",
        source_app="accounting_program",
        event_type="approval.pending",
        title=f"External review {suffix}",
        department_id=department.id,
        status="For Review",
    )
    db.add(item)
    db.commit()
    return item


def assert_still_linked(db, item, field, expected, status):
    # A rejected workflow cannot dirty a Session later committed by its caller.
    db.commit()
    db.refresh(item)
    assert getattr(item, field) == expected
    assert item.status == status
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("actor", ["manager", "owner"])
def test_missing_linked_task_fails_closed_instead_of_replacing_id(context, actor):
    db, front, _, owner, manager = context
    item = item_for(db, front, f"task-dangling-{actor}")
    item.linked_task_id = 999999
    db.commit()
    with pytest.raises(HTTPException) as exc:
        create_task(db, manager if actor == "manager" else owner, item.id)
    assert exc.value.status_code == 409
    assert "no longer exists" in str(exc.value.detail)
    assert_still_linked(db, item, "linked_task_id", 999999, "For Review")
    assert db.query(models.Task).count() == 0


@pytest.mark.parametrize("actor", ["manager", "owner"])
def test_missing_linked_approval_fails_closed_instead_of_replacing_id(context, actor):
    db, front, _, owner, manager = context
    item = item_for(db, front, f"approval-dangling-{actor}")
    item.linked_approval_id = 888888
    db.commit()
    with pytest.raises(HTTPException) as exc:
        create_approval(db, manager if actor == "manager" else owner, item.id)
    assert exc.value.status_code == 409
    assert "no longer exists" in str(exc.value.detail)
    assert_still_linked(db, item, "linked_approval_id", 888888, "For Review")
    assert db.query(models.Approval).count() == 0


@pytest.mark.parametrize(
    ("source_type", "source_id_kind"),
    [
        ("ops_need", "self"),
        ("external_review_item", "other"),
        (None, "self"),
    ],
)
def test_unrelated_approval_id_is_not_returned_from_review_retry(context, source_type, source_id_kind):
    db, front, _, owner, _ = context
    item = item_for(db, front, f"other-source-{source_type}-{source_id_kind}")
    other = item_for(db, front, f"other-target-{source_type}-{source_id_kind}")
    approval = models.Approval(
        title="Unrelated business approval", status="Pending",
        department_id=front.id,
        source_type=source_type,
        source_id=item.id if source_id_kind == "self" else other.id,
    )
    db.add(approval)
    db.flush()
    item.linked_approval_id = approval.id
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_approval(db, owner, item.id)
    assert exc.value.status_code == 409
    assert "another source" in str(exc.value.detail)
    assert_still_linked(db, item, "linked_approval_id", approval.id, "For Review")
    assert db.query(models.Approval).count() == 1


@pytest.mark.parametrize("status", ["Approved", "Rejected"])
def test_terminal_approval_cannot_be_returned_as_pending_retry(context, status):
    db, front, _, owner, _ = context
    item = item_for(db, front, f"stale-approval-{status}")
    approval = models.Approval(
        title="Former decision", status=status,
        department_id=front.id,
        source_type="external_review_item", source_id=item.id,
    )
    db.add(approval)
    db.flush()
    item.linked_approval_id = approval.id
    db.commit()
    with pytest.raises(HTTPException) as exc:
        create_approval(db, owner, item.id)
    assert exc.value.status_code == 409
    assert "no longer pending" in str(exc.value.detail)
    assert_still_linked(db, item, "linked_approval_id", approval.id, "For Review")


def test_valid_task_retry_still_returns_exact_existing_task_without_new_log(context):
    db, front, _, _, manager = context
    item = item_for(db, front, "task-happy")
    task, _ = create_task(db, manager, item.id)
    count = db.query(models.ActivityLog).count()
    again, result_item = create_task(db, manager, item.id)
    assert again.id == task.id
    assert result_item.status == "In Progress"
    assert db.query(models.Task).count() == 1
    assert db.query(models.ActivityLog).count() == count


def test_valid_approval_retry_still_returns_exact_pending_approval(context):
    db, front, _, _, manager = context
    item = item_for(db, front, "approval-happy")
    approval, _ = create_approval(db, manager, item.id)
    count = db.query(models.ActivityLog).count()
    same, result_item = create_approval(db, manager, item.id)
    assert same.id == approval.id
    assert result_item.status == "Pending Approval"
    assert db.query(models.Approval).count() == 1
    assert db.query(models.ActivityLog).count() == count


def test_manager_still_cannot_reuse_task_from_foreign_department(context):
    db, front, maintenance, owner, manager = context
    item = item_for(db, front, "foreign-task-scope")
    task, _ = create_task(db, owner, item.id, department_id=maintenance.id)
    with pytest.raises(HTTPException) as exc:
        create_task(db, manager, item.id)
    assert exc.value.status_code == 403
    assert db.query(models.Task).count() == 1
    assert db.get(models.Task, task.id).department_id == maintenance.id


def test_valid_new_records_still_create_and_link_once(context):
    db, front, _, _, manager = context
    task_item = item_for(db, front, "fresh-task")
    approval_item = item_for(db, front, "fresh-approval")
    task, changed_task = create_task(db, manager, task_item.id)
    approval, changed_approval = create_approval(db, manager, approval_item.id)
    assert changed_task.linked_task_id == task.id
    assert changed_task.status == "In Progress"
    assert changed_approval.linked_approval_id == approval.id
    assert changed_approval.status == "Pending Approval"
    assert approval.source_type == "external_review_item"
    assert approval.source_id == approval_item.id


@pytest.mark.parametrize("actor", ["owner", "manager"])
def test_archived_linked_task_cannot_be_reused_by_active_review(context, actor):
    db, front, _, owner, manager = context
    item = item_for(db, front, f"archived-task-{actor}")
    task = models.Task(
        title="Closed historical task",
        department_id=front.id,
        status="Done",
        hidden_from_active=True,
        archive_reason="historical_completion",
    )
    db.add(task)
    db.flush()
    item.linked_task_id = task.id
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_task(db, owner if actor == "owner" else manager, item.id)
    assert exc.value.status_code == 409
    assert "Archived linked Task" in str(exc.value.detail)
    assert_still_linked(db, item, "linked_task_id", task.id, "For Review")
    db.refresh(task)
    assert task.hidden_from_active is True
    assert task.archive_reason == "historical_completion"
    assert db.query(models.Task).count() == 1


@pytest.mark.parametrize("actor", ["owner", "manager"])
def test_archived_pending_approval_cannot_be_reused_by_active_review(context, actor):
    db, front, _, owner, manager = context
    item = item_for(db, front, f"archived-approval-{actor}")
    approval = models.Approval(
        title="Historical pending approval",
        source_type="external_review_item",
        source_id=item.id,
        department_id=front.id,
        status="Pending",
        hidden_from_active=True,
        archive_reason="manual_archive",
    )
    db.add(approval)
    db.flush()
    item.linked_approval_id = approval.id
    db.commit()

    with pytest.raises(HTTPException) as exc:
        create_approval(db, owner if actor == "owner" else manager, item.id)
    assert exc.value.status_code == 409
    assert "Archived linked Approval" in str(exc.value.detail)
    assert_still_linked(db, item, "linked_approval_id", approval.id, "For Review")
    db.refresh(approval)
    assert approval.status == "Pending"
    assert approval.hidden_from_active is True
    assert approval.archive_reason == "manual_archive"
    assert db.query(models.Approval).count() == 1
