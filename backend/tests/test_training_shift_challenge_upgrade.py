"""A shift challenge adds work only to a validated synthetic installation."""
from test_training_named_room_upgrade import isolated_desktop  # noqa: F401
from app import models
from app import foundation_models as fm
from scripts.seed_training_demo import ensure_shift_challenge_data
from scripts.seed_training_demo import improve_existing_staff_examples
import pytest


def test_challenges_are_additive_preserve_saved_followup_and_are_idempotent(isolated_desktop):
    state, path, Session = isolated_desktop
    assert ensure_shift_challenge_data(path, state) > 0
    with Session() as db:
        tasks = db.query(models.Task).filter(models.Task.title.like('[TRAINING] SHIFT-%')).all()
        assert tasks
        for task in tasks:
            assert db.get(models.User, task.assigned_to_id).role == 'staff'
        task = tasks[0]
        db.add(models.Comment(parent_type='tasks', parent_id=task.id, author_id=task.assigned_to_id,
                              comment_type='Shift follow-up', body='Keep my earlier practice note.'))
        notices = db.query(fm.Notification).filter_by(kind='Shift notice').all()
        assert notices and all(n.action_url is None for n in notices)
        db.commit()
        count = db.query(models.Task).count()
    assert ensure_shift_challenge_data(path, state) == 0
    with Session() as db:
        assert db.query(models.Task).count() == count
        assert db.query(models.Comment).filter_by(body='Keep my earlier practice note.').count() == 1


@pytest.mark.parametrize('setting', [('ENVIRONMENT','production'),('ALLOW_DEFAULT_ADMIN_BOOTSTRAP','true')])
def test_challenge_upgrade_refuses_other_environments_before_adding_jobs(isolated_desktop, monkeypatch, setting):
    state, path, Session = isolated_desktop
    monkeypatch.setenv(*setting)
    with pytest.raises(SystemExit,match='REFUSED'):
        ensure_shift_challenge_data(path,state)
    with Session() as db:
        assert db.query(models.Task).count() == 0


def test_frontend_and_seed_catalogs_match_across_isolated_build_contexts():
    import json
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    frontend = json.loads((root / "frontend/lib/shift-challenge-cases.json").read_text())
    backend = json.loads((root / "backend/scripts/shift_challenge_cases.json").read_text())
    assert frontend == backend
    assert len({case["department"] for case in frontend}) == 7


def test_old_examples_preserve_changes_and_add_personal_practice_idempotently(isolated_desktop):
    _, _, Session = isolated_desktop
    with Session() as db:
        dept = db.query(models.Department).filter_by(name='Front Desk').one()
        worker = db.query(models.User).filter_by(email='reception-pm@training.invalid').one()
        old = 'TRAINING ONLY — record responsible person and pending follow-up.'
        untouched = models.ShiftNote(title='[TRAINING] Front Desk Night handover #3',
                                     department_id=dept.id, status='Follow', note=old)
        edited = models.ShiftNote(title='[TRAINING] Front Desk PM handover #2',
                                  department_id=dept.id, status='Seen', note='My own saved note')
        db.add_all([untouched, edited]); db.commit()
        assert improve_existing_staff_examples(db) > 0
        db.commit()
        assert 'hot water' in untouched.note
        assert edited.note == 'My own saved note'
        personal = db.query(models.Task).filter_by(assigned_to_id=worker.id).all()
        assert {item.status for item in personal} >= {'To Do', 'Review'}
        personal[0].note = 'My saved work'; db.commit()
        assert improve_existing_staff_examples(db) == 0
        db.commit()
        assert personal[0].note == 'My saved work'


def test_old_repair_examples_change_only_untouched_placeholders(isolated_desktop):
    _, _, Session = isolated_desktop
    with Session() as db:
        department = models.Department(name='Maintenance')
        solace = models.RoomArea(name='Solace', kind='room', status='active')
        pool = models.RoomArea(name='Pool', kind='area', status='active')
        db.add_all([department, solace, pool]); db.flush()
        generic = 'Fictional repair scenario for practical training.'
        untouched = models.Fix(title='[TRAINING] Solace: simulated maintenance issue',
                               problem=generic, status='Working', department_id=department.id, room_area_id=solace.id)
        changed = models.Fix(title='[TRAINING] Pool: simulated maintenance issue',
                             problem=generic, status='Open', department_id=department.id, room_area_id=pool.id)
        db.add_all([untouched, changed]); db.flush()
        db.add(models.Comment(parent_type='fixes', parent_id=changed.id, body='Keep my work'))
        db.commit()
        improve_existing_staff_examples(db); db.commit()
        assert 'air conditioner' in untouched.problem
        assert 'air conditioner' in untouched.title.lower()
        assert changed.problem == generic
        assert changed.title == '[TRAINING] Pool: simulated maintenance issue'
        assert improve_existing_staff_examples(db) == 0
