import json
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models as m
from app.clock import utc_now
from app.database import get_db
from app.routers.api import require_user, router


@pytest.fixture
def context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    dept, other = m.Department(name="Front"), m.Department(name="Other")
    db.add_all([dept, other]); db.flush()
    user = m.User(name="Operator", role="owner", department_id=dept.id, is_active=True)
    db.add(user); db.commit()
    app = FastAPI(); app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_user] = lambda: user
    with TestClient(app) as client:
        yield db, client, user, other
    db.close(); engine.dispose()


@pytest.mark.parametrize("role,allowed", [("owner", True), ("admin", True), ("manager", False), ("lead", False), ("supervisor", False), ("staff", False), ("unknown", False)])
def test_only_owner_admin_can_run_global_archive_even_with_forged_body(context, role, allowed):
    db, client, user, other = context
    user.role = role
    task = m.Task(title="Other department completed work", department_id=other.id, status="Done", completed_at=utc_now()-timedelta(days=2))
    db.add(task); db.commit()
    response = client.post("/api/auto-archive/run", json={"role": "owner", "department_id": other.id})
    assert response.status_code == (200 if allowed else 403)
    db.refresh(task)
    assert task.hidden_from_active is allowed
    assert db.query(m.Task).count() == 1
    logs = db.query(m.ActivityLog).all()
    assert len(logs) == (1 if allowed else 0)
    if allowed:
        assert logs[0].actor_id == user.id
        assert logs[0].entity_type == "tasks" and logs[0].entity_id == task.id
        assert json.loads(logs[0].metadata_json)["trigger"] == "manual_archive"


@pytest.mark.parametrize("model,status,resource,reason", [
    (m.Task, "Done", "tasks", "done_24h"),
    (m.GuestNote, "Done", "guests", "resolved_48h"),
    (m.Fix, "Verified", "fixes", "verified_24h"),
    (m.Approval, "Approved", "approvals", "decision_done"),
    (m.Post, "Posted", "posts", "posted"),
    (m.Memo, "Active", "memos", "expired"),
    (m.Project, "Done", "projects", "done_3d"),
    (m.ShiftNote, "Seen", "shift-notes", "seen_next_shift"),
])
def test_every_manually_archived_record_keeps_an_attributed_audit_and_retry_is_safe(context, model, status, resource, reason):
    db, client, user, other = context
    row = model(title="Synthetic completed work", status=status, department_id=other.id)
    if model is m.Memo:
        row.expiry_date = utc_now()-timedelta(days=5)
    else:
        row.completed_at = utc_now()-timedelta(days=5)
    row.updated_at = utc_now()-timedelta(days=5)
    db.add(row); db.commit()
    assert client.post("/api/auto-archive/run").status_code == 200
    assert client.post("/api/auto-archive/run").status_code == 200
    db.refresh(row)
    assert row.hidden_from_active and row.archive_reason == reason
    assert db.query(model).count() == 1
    log = db.query(m.ActivityLog).one()
    assert (log.entity_type, log.entity_id, log.actor_id, log.action) == (resource, row.id, user.id, "archived")
    assert json.loads(log.metadata_json) == {"reason": reason, "trigger": "manual_archive"}
    response = client.get("/api/history/search/all", params={"kind": resource})
    assert response.status_code == 200
    history = response.json()
    assert any(item["id"] == row.id for item in history["items"])


def test_manual_archive_keeps_recent_and_unfinished_work_visible(context):
    db, client, _, other = context
    recent = m.Task(title="Recent completion", department_id=other.id, status="Done", completed_at=utc_now()-timedelta(hours=1))
    unfinished = m.Task(title="Still in progress", department_id=other.id, status="Doing", completed_at=utc_now()-timedelta(days=5))
    db.add_all([recent, unfinished]); db.commit()
    assert client.post("/api/auto-archive/run").json()["tasks"] == 0
    assert db.query(m.Task).filter(m.Task.hidden_from_active == False).count() == 2
    assert db.query(m.ActivityLog).count() == 0


def test_audit_failure_cannot_commit_archive_without_its_attribution(context):
    db, client, _, other = context
    task = m.Task(title="Completed work", department_id=other.id, status="Done", completed_at=utc_now()-timedelta(days=2))
    db.add(task); db.flush()
    db.add(m.ActivityLog(entity_type="tasks", entity_id=task.id, action="created", message="Existing evidence"))
    db.commit()
    def fail_audit(*args):
        raise RuntimeError("Synthetic audit persistence failure")
    event.listen(m.ActivityLog, "before_insert", fail_audit)
    try:
        with pytest.raises(RuntimeError, match="Synthetic audit"):
            client.post("/api/auto-archive/run")
        db.rollback()
    finally:
        event.remove(m.ActivityLog, "before_insert", fail_audit)
    db.refresh(task)
    assert task.hidden_from_active is False and task.archived_at is None
    assert db.query(m.ActivityLog).one().message == "Existing evidence"
