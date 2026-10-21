"""My Work must not leak Task details from unauthorized departments."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers import my_work as agenda


NOW = datetime(2026, 10, 20, 17, 30, tzinfo=timezone.utc)


@pytest.fixture()
def context(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front = models.Department(name="Front Desk")
    maintenance = models.Department(name="Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    staff = models.User(name="Staff", role="staff", department_id=front.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=front.id, is_active=True)
    owner = models.User(name="Owner", role="owner", department_id=front.id, is_active=True)
    db.add_all([staff, manager, owner])
    db.flush()
    db.add(models.UserDepartment(user_id=staff.id, department_id=front.id, is_primary=True))
    db.commit()
    monkeypatch.setattr(agenda, "utc_now", lambda: NOW)
    try:
        yield db, front, maintenance, staff, manager, owner
    finally:
        db.close()
        engine.dispose()


def assign(db, person, department, title, *, status="To Do", completed=None, hidden=False):
    row = models.Task(
        assigned_to_id=person.id,
        department_id=department.id if department else None,
        title=title,
        status=status,
        completed_at=completed,
        hidden_from_active=hidden,
    )
    db.add(row)
    db.commit()
    return row


def every_title(result):
    return [
        item["title"]
        for rows in result["groups"].values()
        for item in rows
    ]


def test_staff_assignment_does_not_grant_view_of_foreign_department(context):
    db, front, maintenance, staff, _, _ = context
    assign(db, staff, front, "Authorized morning opening")
    assign(db, staff, maintenance, "Private maintenance incident")
    assign(db, staff, maintenance, "Confidential completed incident",
           status="Done", completed=NOW - timedelta(hours=1), hidden=True)
    result = agenda.my_work(user=staff, db=db)
    assert every_title(result) == ["Authorized morning opening"]
    assert result["groups"]["recently_completed"] == []
    assert result["groups"]["upcoming"][0]["department_name"] == "Front Desk"


def test_revoked_secondary_department_disappears_from_both_work_sections(context):
    db, front, maintenance, staff, _, _ = context
    membership = models.UserDepartment(
        user_id=staff.id, department_id=maintenance.id, is_primary=False,
    )
    db.add(membership)
    db.commit()
    assign(db, staff, maintenance, "Previously authorized task")
    assign(db, staff, maintenance, "Previously completed task",
           status="Done", completed=NOW - timedelta(days=1), hidden=True)
    assert len(every_title(agenda.my_work(user=staff, db=db))) == 2
    db.delete(membership)
    db.commit()
    result = agenda.my_work(user=staff, db=db)
    assert every_title(result) == []
    assert all(not rows for rows in result["groups"].values())


def test_scope_is_applied_before_recently_completed_limit(context):
    db, front, maintenance, staff, _, _ = context
    assign(db, staff, front, "Older authorized 1",
           status="Done", completed=NOW - timedelta(days=2), hidden=True)
    assign(db, staff, front, "Older authorized 2",
           status="Done", completed=NOW - timedelta(days=3), hidden=True)
    for i in range(16):
        assign(db, staff, maintenance, f"Recent unauthorized {i}",
               status="Done", completed=NOW - timedelta(minutes=i), hidden=True)
    result = agenda.my_work(user=staff, db=db)
    assert [row["title"] for row in result["groups"]["recently_completed"]] == [
        "Older authorized 1", "Older authorized 2",
    ]


def test_staff_unscoped_task_assignment_is_not_exposed(context):
    db, _, _, staff, _, _ = context
    assign(db, staff, None, "Unscoped confidential task")
    assert "Unscoped confidential task" not in every_title(agenda.my_work(user=staff, db=db))


@pytest.mark.parametrize("role", ["manager", "owner"])
def test_explicit_global_read_roles_retain_cross_department_my_work(context, role):
    db, front, maintenance, _, manager, owner = context
    person = manager if role == "manager" else owner
    assign(db, person, front, "Own department")
    assign(db, person, maintenance, "Cross department")
    assign(db, person, maintenance, "Cross department completed",
           status="Done", completed=NOW - timedelta(days=1), hidden=True)
    result = agenda.my_work(user=person, db=db)
    assert set(every_title(result)) == {
        "Own department", "Cross department", "Cross department completed",
    }
    assert {
        row["department_name"]
        for rows in result["groups"].values()
        for row in rows
    } == {"Front Desk", "Maintenance"}
