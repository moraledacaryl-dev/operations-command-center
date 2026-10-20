"""Routine task generation must respect permissions, local dates, and idempotency."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers import api


NOW = datetime(2026, 10, 20, 17, 30, tzinfo=timezone.utc)
# Local date is already October 21 in Asia/Manila.


@pytest.fixture()
def context(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    department = models.Department(name="Front Desk")
    other_department = models.Department(name="Café")
    db.add_all([department, other_department])
    db.flush()
    owner = models.User(
        name="Owner", email="routine-owner@example.com",
        role="owner", department_id=department.id, is_active=True,
    )
    staff = models.User(
        name="Staff", email="routine-staff@example.com",
        role="staff", department_id=department.id, is_active=True,
    )
    outsider = models.User(
        name="Other lead", email="routine-outside@example.com",
        role="lead", department_id=other_department.id, is_active=True,
    )
    db.add_all([owner, staff, outsider])
    db.flush()
    routine = models.RoutineTemplate(
        title="Opening checklist", department_id=department.id,
        assigned_to_id=staff.id, status="Active", priority="High",
        checklist="Check keys and room readiness",
    )
    db.add(routine)
    db.commit()
    monkeypatch.setattr(api, "utc_now", lambda: NOW)
    try:
        yield db, owner, staff, outsider, routine, department, other_department
    finally:
        db.close()
        engine.dispose()


def generate(db, user, routine):
    return api.generate_routine_task(routine_id=routine.id, user=user, db=db)


def test_same_manila_day_is_idempotent_even_after_renaming_task(context):
    db, owner, _, _, routine, _, _ = context
    first = generate(db, owner, routine)
    task = db.get(models.Task, first["id"])
    assert first["note"].startswith(f"Generated from routine {routine.id} on 2026-10-21.")
    assert first["assigned_to_id"] == routine.assigned_to_id
    assert first["priority"] == "High"
    task.title = "Manually renamed checklist"
    db.commit()
    second = generate(db, owner, routine)
    assert second["id"] == first["id"]
    assert db.query(models.Task).count() == 1


def test_archived_completed_task_is_not_regenerated_same_day(context):
    db, owner, _, _, routine, _, _ = context
    first = generate(db, owner, routine)
    task = db.get(models.Task, first["id"])
    task.status = "Done"
    task.hidden_from_active = True
    db.commit()
    with pytest.raises(HTTPException) as exc:
        generate(db, owner, routine)
    assert exc.value.status_code == 409
    assert "History" in exc.value.detail
    assert db.query(models.Task).count() == 1


def test_last_generation_marker_blocks_recreation_after_task_deleted(context):
    db, owner, _, _, routine, _, _ = context
    first = generate(db, owner, routine)
    db.delete(db.get(models.Task, first["id"]))
    db.commit()
    with pytest.raises(HTTPException) as exc:
        generate(db, owner, routine)
    assert exc.value.status_code == 409
    assert db.query(models.Task).count() == 0


def test_next_local_day_allows_a_new_generation(context, monkeypatch):
    db, owner, _, _, routine, _, _ = context
    first = generate(db, owner, routine)
    monkeypatch.setattr(api, "utc_now", lambda: NOW + timedelta(days=1))
    next_day = generate(db, owner, routine)
    assert first["id"] != next_day["id"]
    assert "on 2026-10-22." in next_day["note"]
    assert db.query(models.Task).count() == 2


def test_paused_or_archived_routine_cannot_generate(context):
    db, owner, _, _, routine, _, _ = context
    routine.status = "Paused"
    db.commit()
    with pytest.raises(HTTPException) as paused:
        generate(db, owner, routine)
    assert paused.value.status_code == 409

    routine.status = "Active"
    routine.hidden_from_active = True
    db.commit()
    with pytest.raises(HTTPException) as archived:
        generate(db, owner, routine)
    assert archived.value.status_code == 409
    assert db.query(models.Task).count() == 0


@pytest.mark.parametrize("account_index", [2, 3])
def test_staff_or_out_of_department_lead_cannot_generate_tasks(context, account_index):
    db, _, staff, outsider, routine, _, _ = context
    user = {2: staff, 3: outsider}[account_index]
    with pytest.raises(HTTPException) as exc:
        generate(db, user, routine)
    assert exc.value.status_code == 403
    assert db.query(models.Task).count() == 0


def test_forged_note_in_other_department_cannot_expose_task(context):
    db, owner, _, _, routine, _, other_department = context
    db.add(models.Task(
        title="Other department private task",
        department_id=other_department.id,
        note=f"Generated from routine {routine.id} on 2026-10-21.\\nImpersonated",
        status="To Do",
    ))
    db.commit()
    generated = generate(db, owner, routine)
    assert generated["title"] == "Opening checklist"
    assert generated["department_id"] == routine.department_id
    assert db.query(models.Task).count() == 2
