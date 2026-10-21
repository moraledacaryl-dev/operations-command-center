"""Generic PATCH must compare client versions after locking and refreshing the row.

Production PostgreSQL has row-level SELECT FOR UPDATE; SQLite regression cases
exercise the stale identity-map and two independent session behavior.
"""

from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import as_utc
from app.routers.authorized_crud import update_resource_authorized


@pytest.fixture()
def context(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'optimistic_edits.db'}")
    models.Base.metadata.create_all(engine)
    Factory = sessionmaker(bind=engine, autoflush=False)
    first = Factory()
    department = models.Department(name="Front Desk")
    first.add(department)
    first.flush()
    owner = models.User(
        name="Owner", role="owner", is_active=True, department_id=department.id
    )
    task = models.Task(
        title="Original assignment", department_id=department.id, status="To Do",
    )
    first.add_all([owner, task])
    first.commit()
    first.refresh(task)
    try:
        yield Factory, department.id, owner.id, task.id
    finally:
        first.close()
        engine.dispose()


def test_two_sessions_with_same_version_cannot_both_save(context):
    Factory, _, user_id, task_id = context
    editor_a, editor_b = Factory(), Factory()
    try:
        task_a = editor_a.get(models.Task, task_id)
        task_b = editor_b.get(models.Task, task_id)
        initial = as_utc(task_a.updated_at).isoformat()
        assert as_utc(task_b.updated_at).isoformat() == initial

        save_a = update_resource_authorized(
            "tasks", task_id,
            {"title": "Edit from A", "expected_updated_at": initial},
            user=editor_a.get(models.User, user_id), db=editor_a,
        )
        assert save_a["title"] == "Edit from A"
        assert as_utc(editor_a.get(models.Task, task_id).updated_at).isoformat() != initial

        with pytest.raises(HTTPException) as exc:
            update_resource_authorized(
                "tasks", task_id,
                {"title": "Edit from B", "expected_updated_at": initial},
                user=editor_b.get(models.User, user_id), db=editor_b,
            )
        assert exc.value.status_code == 409
        assert "Refresh before saving" in str(exc.value.detail)
        editor_b.commit()
        editor_b.refresh(task_b)
        assert task_b.title == "Edit from A"
        assert editor_b.query(models.ActivityLog).count() == 1
    finally:
        editor_a.close()
        editor_b.close()


def test_cached_identity_map_object_cannot_bypass_fresh_version_read(context):
    Factory, _, user_id, task_id = context
    reader, updater = Factory(), Factory()
    try:
        stale = reader.get(models.Task, task_id)
        original_version = as_utc(stale.updated_at).isoformat()
        updater_user = updater.get(models.User, user_id)
        update_resource_authorized(
            "tasks", task_id,
            {"priority": "Urgent", "expected_updated_at": original_version},
            user=updater_user, db=updater,
        )

        # The first Session still has an outdated identity-map instance.
        assert stale.priority == "Normal"
        with pytest.raises(HTTPException) as exc:
            update_resource_authorized(
                "tasks", task_id,
                {"title": "Should not overwrite", "expected_updated_at": original_version},
                user=reader.get(models.User, user_id), db=reader,
            )
        assert exc.value.status_code == 409
        reader.commit()
        reader.refresh(stale)
        assert stale.title == "Original assignment"
        assert stale.priority == "Urgent"
    finally:
        updater.close()
        reader.close()


def test_bad_version_rejected_without_mutating_supplied_payload(context):
    Factory, _, user_id, task_id = context
    db = Factory()
    try:
        user = db.get(models.User, user_id)
        payload = {"title": "Mutated", "expected_updated_at": "not-a-date"}
        with pytest.raises(HTTPException) as exc:
            update_resource_authorized("tasks", task_id, payload, user=user, db=db)
        assert exc.value.status_code == 422
        assert payload["expected_updated_at"] == "not-a-date"
        db.commit()
        assert db.get(models.Task, task_id).title == "Original assignment"
        assert db.query(models.ActivityLog).count() == 0
    finally:
        db.close()


def test_compatible_patch_without_version_still_supported(context):
    Factory, _, user_id, task_id = context
    db = Factory()
    try:
        user = db.get(models.User, user_id)
        updated = update_resource_authorized(
            "tasks", task_id, {"title": "Legacy client edit"}, user=user, db=db,
        )
        assert updated["title"] == "Legacy client edit"
    finally:
        db.close()


def test_current_version_can_be_used_after_refresh(context):
    Factory, _, user_id, task_id = context
    db = Factory()
    try:
        user = db.get(models.User, user_id)
        token = as_utc(db.get(models.Task, task_id).updated_at).isoformat()
        one = update_resource_authorized(
            "tasks", task_id, {"note": "First", "expected_updated_at": token},
            user=user, db=db,
        )
        two = update_resource_authorized(
            "tasks", task_id,
            {"note": "Second", "expected_updated_at": one["updated_at"]},
            user=user, db=db,
        )
        assert two["note"] == "Second"
        assert db.query(models.ActivityLog).count() == 2
    finally:
        db.close()
