"""Dashboard attention lists must agree with actionable, nonterminal states."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.api import dashboard


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
    staff = models.User(name="Front staff", role="staff", department_id=front.id, is_active=True)
    db.add_all([owner, staff])
    db.flush()
    db.add(models.UserDepartment(user_id=staff.id, department_id=front.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, staff
    finally:
        db.close()
        engine.dispose()


def seed(db, department, model, title, status, urgency="Urgent", hidden=False):
    kwargs = dict(title=title, status=status, department_id=department.id, hidden_from_active=hidden)
    if model is models.Task:
        kwargs["priority"] = urgency
    elif model in {models.GuestNote, models.Fix}:
        kwargs["urgency"] = urgency
    obj = model(**kwargs)
    db.add(obj)
    db.commit()
    return obj


def titles_by_kind(result):
    return {(item["kind"], item["title"]) for item in result["focus"]}


def test_terminal_urgent_records_are_not_presented_as_needing_attention(context):
    db, front, _, owner, _ = context
    seed(db, front, models.Task, "Task completed", "Done")
    seed(db, front, models.GuestNote, "Guest matter resolved", "Done")
    seed(db, front, models.Fix, "Maintenance verified", "Verified")
    seed(db, front, models.Task, "Task underway", "Doing")
    seed(db, front, models.GuestNote, "Guest awaiting follow up", "Follow")
    seed(db, front, models.Fix, "Repair ready for verification", "Done")
    seed(db, front, models.Post, "Creative awaiting approval", "Review")
    result = dashboard(department_id=None, user=owner, db=db)
    assert titles_by_kind(result) == {
        ("Task", "Task underway"),
        ("Guest", "Guest awaiting follow up"),
        ("Fix", "Repair ready for verification"),
        ("Post", "Creative awaiting approval"),
    }
    assert result["counts"]["fixes"] == 1


def test_urgent_closed_items_do_not_displace_open_ones_from_bounded_focus(context):
    db, front, _, owner, _ = context
    for n in range(5):
        seed(db, front, models.Task, f"Finished {n}", "Done")
    for n in range(3):
        seed(db, front, models.Task, f"Outstanding {n}", "To Do")
    result = dashboard(department_id=None, user=owner, db=db)
    shown = {item["title"] for item in result["focus"] if item["kind"] == "Task"}
    assert shown == {f"Outstanding {n}" for n in range(3)}


def test_dashboard_focus_respects_departments_and_archiving(context):
    db, front, maintenance, owner, staff = context
    seed(db, front, models.Task, "Front open", "To Do")
    seed(db, maintenance, models.Task, "Other department", "To Do")
    seed(db, front, models.GuestNote, "Archived", "Open", hidden=True)
    scoped = dashboard(department_id=None, user=staff, db=db)
    assert titles_by_kind(scoped) == {("Task", "Front open")}
    global_view = dashboard(department_id=None, user=owner, db=db)
    assert titles_by_kind(global_view) == {
        ("Task", "Front open"), ("Task", "Other department"),
    }


def test_dashboard_explicit_department_limits_global_view(context):
    db, front, maintenance, owner, _ = context
    seed(db, front, models.Fix, "Front urgent repair", "Working")
    seed(db, maintenance, models.Fix, "Maintenance urgent repair", "Working")
    filtered = dashboard(department_id=front.id, user=owner, db=db)
    assert titles_by_kind(filtered) == {("Fix", "Front urgent repair")}
    assert filtered["counts"]["fixes"] == 1
