"""Stored notification copies must follow current source-record visibility."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import foundation_models as f, models as m
from app.database import get_db
from app.routers import notifications
from app.routers.api import require_user
from app.services.notifications import notify_user


@pytest.fixture()
def context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front, maintenance = m.Department(name="Front"), m.Department(name="Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    user = m.User(name="Staff", role="staff", department_id=front.id, is_active=True)
    db.add(user)
    db.flush()
    task = m.Task(title="Restricted source", department_id=front.id)
    db.add(task)
    db.flush()
    notice = notify_user(db, user.id, "assignment", "Private task title", "Private context",
                         source_type="tasks", source_id=task.id)
    general = notify_user(db, user.id, "system", "General notice")
    db.commit()
    app = FastAPI()
    app.include_router(notifications.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_user] = lambda: user
    with TestClient(app) as client:
        yield db, client, user, front, maintenance, task, notice, general
    db.close()
    engine.dispose()


def test_department_revocation_hides_existing_notification_and_count(context):
    db, client, user, _, other, _, notice, general = context
    assert client.get("/api/notifications").json()["unread_count"] == 2
    user.department_id = other.id
    db.commit()
    response = client.get("/api/notifications").json()
    assert [row["id"] for row in response["items"]] == [general.id]
    assert response["unread_count"] == 1
    assert db.get(f.Notification, notice.id).body == "Private context"


@pytest.mark.parametrize("action", ["read", "dismiss"])
def test_direct_actions_do_not_serialize_revoked_source(context, action):
    db, client, user, _, other, _, notice, _ = context
    user.department_id = other.id
    db.commit()
    response = client.post(f"/api/notifications/{notice.id}/{action}")
    assert response.status_code == 404
    assert "Private" not in response.text
    db.refresh(notice)
    assert notice.read_at is None and notice.dismissed_at is None


def test_read_all_only_updates_currently_visible_notifications(context):
    db, client, user, _, other, _, notice, general = context
    user.department_id = other.id
    db.commit()
    assert client.post("/api/notifications/read-all").json()["updated"] == 1
    db.refresh(notice)
    db.refresh(general)
    assert notice.read_at is None
    assert general.read_at is not None


def test_secondary_membership_removal_and_regrant_preserve_history(context):
    db, client, user, front, other, _, notice, _ = context
    user.department_id = other.id
    membership = m.UserDepartment(user_id=user.id, department_id=front.id)
    db.add(membership)
    db.commit()
    assert client.get("/api/notifications").json()["unread_count"] == 2
    db.delete(membership)
    db.commit()
    assert client.get("/api/notifications").json()["unread_count"] == 1
    db.add(m.UserDepartment(user_id=user.id, department_id=front.id))
    db.commit()
    assert client.get("/api/notifications").json()["unread_count"] == 2
    assert db.get(f.Notification, notice.id) is not None


@pytest.mark.parametrize("role", ["owner", "manager", "lead", "supervisor", "staff"])
def test_current_role_source_visibility_matches_policy(context, role):
    db, client, user, _, other, _, notice, _ = context
    user.department_id, user.role = other.id, role
    db.commit()
    ids = {row["id"] for row in client.get("/api/notifications").json()["items"]}
    assert (notice.id in ids) is (role in {"owner", "manager"})


def test_moved_deleted_unknown_and_malformed_sources_fail_closed(context):
    db, client, user, _, other, task, notice, general = context
    task.department_id = other.id
    for source_type, source_id in [("tasks", "999999"), ("tasks", "bad-id"),
                                   ("unknown", "1"), ("tasks", None), (None, "1")]:
        notify_user(db, user.id, "mention", "Hidden", source_type=source_type, source_id=source_id)
    db.commit()
    result = client.get("/api/notifications").json()
    assert [row["id"] for row in result["items"]] == [general.id]
    assert result["unread_count"] == 1


def test_authorized_archived_record_keeps_historical_notification(context):
    db, client, _, _, _, task, notice, _ = context
    task.hidden_from_active = True
    db.commit()
    assert notice.id in {row["id"] for row in client.get("/api/notifications").json()["items"]}


def test_filtering_happens_before_pagination_and_count(context):
    db, client, user, front, other, task, notice, general = context
    for _ in range(4):
        notify_user(db, user.id, "mention", "Hidden", source_type="tasks", source_id=999999)
    db.commit()
    first = client.get("/api/notifications?limit=1").json()
    assert first["items"][0]["id"] == general.id
    assert first["has_more"] is True
    second = client.get("/api/notifications", params={"limit": 1, "cursor": first["next_cursor"]}).json()
    assert second["items"][0]["id"] == notice.id
    assert second["has_more"] is False
    assert second["unread_count"] == 2


def test_cannot_access_another_users_notification(context):
    db, client, user, front, _, _, _, _ = context
    other = m.User(name="Other", role="staff", department_id=front.id)
    db.add(other)
    db.flush()
    notice = notify_user(db, other.id, "system", "Other private notice")
    db.commit()
    assert client.post(f"/api/notifications/{notice.id}/read").status_code == 404


def test_notification_queries_do_not_grow_with_notification_count(context):
    db, client, user, _, _, task, _, _ = context
    for _ in range(150):
        notify_user(db, user.id, "assignment", "Allowed", source_type="tasks", source_id=task.id)
    db.commit()
    # Warm up expired fixture identities before measuring SQL.
    _ = user.id, user.role, user.department_id
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        result = client.get("/api/notifications?limit=100").json()
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert len(result["items"]) == 100
    assert result["unread_count"] == 152
    assert len(statements) <= 3
