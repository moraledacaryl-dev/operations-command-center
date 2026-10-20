"""Archived workflow records must become visible again after reopening."""

import json
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.services.fix_workflow import reopen_fix
from app.services.operational_workflow import allowed_actions_for, transition_operational


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    department = models.Department(name="Operations")
    db.add(department)
    db.flush()
    owner = models.User(
        name="Owner", email="archive-owner@example.com",
        role="owner", department_id=department.id, is_active=True,
    )
    db.add(owner)
    db.commit()
    try:
        yield db, owner, department
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize(
    ("model", "resource", "finished", "reopened"),
    [
        (models.Task, "tasks", "Done", "Doing"),
        (models.Project, "projects", "Done", "Active"),
        (models.Post, "posts", "Posted", "Draft"),
        (models.GuestNote, "guests", "Done", "Follow"),
        (models.ShiftNote, "shift-notes", "Done", "Follow"),
    ],
)
def test_reopening_archived_operational_record_restores_visibility_and_history(
    context, model, resource, finished, reopened
):
    db, owner, department = context
    archived_at = utc_now() - timedelta(days=2)
    item = model(
        title=f"Archived {resource}", department_id=department.id,
        status=finished, completed_at=archived_at,
        hidden_from_active=True, archived_at=archived_at,
        archive_reason="completed_auto_archive",
    )
    if resource == "posts":
        item.platform = "Instagram"
        item.content_type = "Reel"
    db.add(item)
    db.commit()

    assert "reopen" in allowed_actions_for(db, owner, resource, item)
    restored = transition_operational(db, owner, resource, item.id, "reopen", "Work required again")

    assert restored.status == reopened
    assert restored.hidden_from_active is False
    assert restored.archived_at is None
    assert restored.archive_reason is None
    assert restored.completed_at is None
    assert db.query(model).filter(
        model.id == item.id, model.hidden_from_active.is_(False)
    ).count() == 1

    activity = db.query(models.ActivityLog).filter(
        models.ActivityLog.entity_type == resource,
        models.ActivityLog.entity_id == item.id,
    ).order_by(models.ActivityLog.id.desc()).first()
    assert activity.actor_id == owner.id
    metadata = json.loads(activity.metadata_json)
    assert metadata["previous_archive_reason"] == "completed_auto_archive"
    assert metadata["previous_archived_at"] is not None


def test_reopen_without_required_reason_never_changes_archive_visibility(context):
    db, owner, department = context
    task = models.Task(
        title="Keep archived until valid reopen",
        department_id=department.id, status="Done",
        hidden_from_active=True, archived_at=utc_now(), archive_reason="done_24h",
        completed_at=utc_now(),
    )
    db.add(task)
    db.commit()

    with pytest.raises(HTTPException) as error:
        transition_operational(db, owner, "tasks", task.id, "reopen", "  ")
    assert error.value.status_code == 400
    db.refresh(task)
    assert task.status == "Done"
    assert task.hidden_from_active is True
    assert task.archive_reason == "done_24h"


def test_follow_up_on_auto_archived_seen_shift_restores_active_queue(context):
    db, owner, department = context
    shift = models.ShiftNote(
        title="Old handover needs follow-up",
        department_id=department.id, status="Seen",
        hidden_from_active=True, archived_at=utc_now(),
        archive_reason="seen_next_shift",
    )
    db.add(shift)
    db.commit()

    restored = transition_operational(
        db, owner, "shift-notes", shift.id, "follow-up-seen", "Check room supplies"
    )
    assert restored.status == "Follow"
    assert restored.hidden_from_active is False
    assert restored.archived_at is None
    assert restored.archive_reason is None


def test_reopened_verified_fix_returns_to_active_maintenance(context):
    db, owner, department = context
    archived_at = utc_now() - timedelta(days=1)
    fix = models.Fix(
        title="Leaking sink", department_id=department.id, status="Verified",
        hidden_from_active=True, archived_at=archived_at,
        archive_reason="verified_24h", completed_at=archived_at,
        verified_at=archived_at, verified_by_id=owner.id,
    )
    db.add(fix)
    db.commit()

    reopened = reopen_fix(db, owner, fix.id, "Leak returned")
    assert reopened.status == "Working"
    assert reopened.hidden_from_active is False
    assert reopened.archived_at is None
    assert reopened.archive_reason is None
    assert reopened.completed_at is None
    assert reopened.verified_at is None
    assert reopened.verified_by_id is None
    assert db.query(models.Fix).filter(
        models.Fix.hidden_from_active.is_(False), models.Fix.id == fix.id
    ).count() == 1

    activity = db.query(models.ActivityLog).filter(
        models.ActivityLog.entity_type == "fixes",
        models.ActivityLog.entity_id == fix.id,
    ).order_by(models.ActivityLog.id.desc()).first()
    metadata = json.loads(activity.metadata_json)
    assert metadata["previous_archive_reason"] == "verified_24h"
    assert metadata["previous_archived_at"] is not None


def test_failed_fix_reopen_does_not_restore_archive(context):
    db, owner, department = context
    fix = models.Fix(
        title="Verified", department_id=department.id, status="Verified",
        hidden_from_active=True, archived_at=utc_now(), archive_reason="verified_24h",
    )
    db.add(fix)
    db.commit()
    with pytest.raises(HTTPException) as error:
        reopen_fix(db, owner, fix.id, "  ")
    assert error.value.status_code == 400
    db.refresh(fix)
    assert fix.hidden_from_active is True
