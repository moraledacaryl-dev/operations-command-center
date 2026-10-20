"""My Work agenda uses Philippine workdays and retains recently archived completions."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers import my_work as agenda


NOW = datetime(2026, 10, 20, 17, 30, tzinfo=timezone.utc)
# NOW is 01:30 on October 21 in Manila.


@pytest.fixture()
def context(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    department = models.Department(name="Operations")
    db.add(department)
    db.flush()
    current = models.User(
        name="Assigned", email="assigned@example.com", role="staff",
        department_id=department.id, is_active=True,
    )
    other = models.User(
        name="Other", email="other@example.com", role="staff",
        department_id=department.id, is_active=True,
    )
    db.add_all([current, other])
    db.commit()
    monkeypatch.setattr(agenda, "utc_now", lambda: NOW)
    try:
        yield db, current, other, department
    finally:
        db.close()
        engine.dispose()


def add_task(db, department, owner, title, *, status="To Do", due=None, completed=None, hidden=False):
    task = models.Task(
        title=title,
        department_id=department.id,
        assigned_to_id=owner.id,
        status=status,
        due_date=due,
        completed_at=completed,
        hidden_from_active=hidden,
    )
    db.add(task)
    db.commit()
    return task


def titles(result, section):
    return [row["title"] for row in result["groups"][section]]


def test_agenda_uses_manila_calendar_day_at_utc_boundary(context):
    db, user, _, department = context
    add_task(db, department, user, "Yesterday locally", due=datetime(2026, 10, 20, 15, 59, tzinfo=timezone.utc))
    add_task(db, department, user, "Today at midnight", due=datetime(2026, 10, 20, 16, 0, tzinfo=timezone.utc))
    add_task(db, department, user, "Today at night", due=datetime(2026, 10, 21, 15, 59, tzinfo=timezone.utc))
    add_task(db, department, user, "Tomorrow locally", due=datetime(2026, 10, 21, 16, 0, tzinfo=timezone.utc))
    add_task(db, department, user, "Needs review", status="Review", due=datetime(2026, 10, 19, tzinfo=timezone.utc))
    result = agenda.my_work(user=user, db=db)
    assert titles(result, "overdue") == ["Yesterday locally"]
    assert titles(result, "today") == ["Today at midnight", "Today at night"]
    assert titles(result, "upcoming") == ["Tomorrow locally"]
    assert titles(result, "waiting") == ["Needs review"]


def test_recently_completed_includes_archived_tasks_but_not_older_or_other_users(context):
    db, user, other, department = context
    add_task(db, department, user, "Archived yesterday", status="Done", completed=NOW - timedelta(days=1), hidden=True)
    add_task(db, department, user, "Just finished", status="Done", completed=NOW - timedelta(hours=1), hidden=False)
    add_task(db, department, user, "Older archive", status="Done", completed=NOW - timedelta(days=8), hidden=True)
    add_task(db, department, user, "No completion timestamp", status="Done", hidden=False)
    add_task(db, department, other, "Other person's completion", status="Done", completed=NOW, hidden=True)
    add_task(db, department, user, "Manually archived outstanding", status="To Do", hidden=True)
    add_task(db, department, user, "Still active")
    result = agenda.my_work(user=user, db=db)
    assert titles(result, "recently_completed") == ["Just finished", "Archived yesterday"]
    assert titles(result, "upcoming") == ["Still active"]
    assert all(
        "Other person's completion" not in titles(result, name)
        for name in result["groups"]
    )


def test_recently_completed_is_bounded_to_latest_ten(context):
    db, user, _, department = context
    for n in range(14):
        add_task(db, department, user, f"Done {n}", status="Done", completed=NOW - timedelta(minutes=n), hidden=True)
    result = agenda.my_work(user=user, db=db)
    assert titles(result, "recently_completed") == [f"Done {n}" for n in range(10)]
