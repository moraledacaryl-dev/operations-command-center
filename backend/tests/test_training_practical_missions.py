"""Role-specific missions must preserve old fictional staff work and reject live data."""
import pytest
from app import models, foundation_models as fm
from scripts.seed_training_demo import ensure_training_mission_data
from test_training_existing_upgrade import old_training  # noqa: F401


def test_mission_upgrade_adds_missing_records_only_once_and_keeps_staff_edits(old_training):
    state, db_path, roster = old_training
    from app.database import SessionLocal
    with SessionLocal() as db:
        department = models.Department(name="Front Desk", short_name="FD")
        room = models.RoomArea(name="Perch 1", kind="room", status="active")
        db.add_all([department, room])
        db.flush()
        employee = db.query(models.User).filter_by(email="reception-am@training.invalid").one()
        employee.role = "staff"
        employee.department_id = department.id
        untouched = models.ShiftNote(
            title="[TRAINING] Front Desk Night handover #3", shift="Night",
            status="Follow", note="TRAINING ONLY — record responsible person and pending follow-up.",
            department_id=department.id, submitted_by_id=employee.id,
        )
        edited = models.ShiftNote(
            title="[TRAINING] Front Desk PM handover #2", shift="PM",
            status="Seen", note="Keep my manually edited practice handover.",
            department_id=department.id, submitted_by_id=employee.id,
        )
        db.add_all([untouched, edited])
        db.commit()
        employee_id, pm_id = employee.id, edited.id

    assert ensure_training_mission_data(db_path, state) > 0
    with SessionLocal() as db:
        first_task = db.query(models.Task).filter(
            models.Task.title.like("[TRAINING] SHIFT-FD-01%"),
            models.Task.assigned_to_id == employee_id,
        ).one()
        db.add(models.Comment(
            parent_type="tasks", parent_id=first_task.id, author_id=employee_id,
            comment_type="Shift follow-up", body="Preserve my saved answer",
        ))
        db.commit()

    # Reopening or upgrading the same installer never duplicates or resets work.
    assert ensure_training_mission_data(db_path, state) == 0
    with SessionLocal() as db:
        assert db.get(models.ShiftNote, pm_id).note == "Keep my manually edited practice handover."
        assert "hot water" in db.query(models.ShiftNote).filter_by(
            title="[TRAINING] Front Desk Night handover #3").one().note
        assert db.query(models.Task).filter(models.Task.title.like("[TRAINING] SHIFT-FD-01%")).count() == 1
        assert db.query(fm.Notification).filter_by(kind="Shift notice", user_id=employee_id).count() == 1
        assert db.query(models.Comment).filter_by(body="Preserve my saved answer").count() == 1
        assert db.query(models.GuestNote).filter_by(title="[TRAINING] Perch 1 towel request").count() == 1
        assert roster.is_file()


@pytest.mark.parametrize("name,value", [
    ("ENVIRONMENT", "production"),
    ("ALLOW_DEFAULT_ADMIN_BOOTSTRAP", "true"),
])
def test_training_mission_rejects_nonlocal_or_unapproved_database(old_training, monkeypatch, name, value):
    state, db_path, _ = old_training
    monkeypatch.setenv(name, value)
    with pytest.raises(SystemExit, match="REFUSED"):
        ensure_training_mission_data(db_path, state)
    from app.database import SessionLocal
    with SessionLocal() as db:
        assert db.query(models.Task).count() == 0
