"""Existing desktop training can gain named-room drills without losing history."""
import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models, database
from scripts.seed_training_demo import PEOPLE, ensure_room_practice_data


@pytest.fixture()
def isolated_desktop(tmp_path: Path, monkeypatch):
    state = tmp_path / "OperationsTraining"
    (state / "data").mkdir(parents=True)
    accounts = state / "private" / "accounts"
    accounts.mkdir(parents=True)
    db_file = state / "data" / "operations_training_demo_test.sqlite"
    (state / "data" / ".initialized").write_text("SYNTHETIC_TEST_ONLY\n")
    roster = {"synthetic": True, "accounts": [
        {"name": name, "email": slug + "@training.invalid", "role": role}
        for name, role, slug, _ in PEOPLE
    ]}
    (accounts / "PRIVATE_training_accounts.json").write_text(json.dumps(roster))
    monkeypatch.setenv("ENVIRONMENT", "local")
    monkeypatch.setenv("ALLOW_DEMO_SEED", "false")
    monkeypatch.setenv("ALLOW_DEFAULT_ADMIN_BOOTSTRAP", "false")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///" + db_file.as_posix())

    engine = create_engine("sqlite:///" + db_file.as_posix(), future=True)
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)
    monkeypatch.setattr(database, "SessionLocal", Session)
    with Session() as session:
        dept = models.Department(name="Front Desk")
        session.add(dept)
        session.flush()
        for name, role, slug, _ in PEOPLE:
            session.add(models.User(name=name, email=slug + "@training.invalid",
                                    role=role, department_id=dept.id,
                                    password_hash="fictional-hash", is_active=True))
        session.add(models.RoomArea(name="Old training room", kind="room", status="active",
                                    note="Keep this earlier practice record."))
        session.commit()
    yield state, db_file, Session
    engine.dispose()


def test_room_upgrade_is_additive_and_idempotent(isolated_desktop):
    state, db_file, Session = isolated_desktop
    with Session() as db:
        old_user_count = db.query(models.User).count()
        old_room_count = db.query(models.RoomArea).count()
    assert ensure_room_practice_data(db_file, state) == 10  # eight rooms and two issues
    assert ensure_room_practice_data(db_file, state) == 0
    with Session() as db:
        assert db.query(models.User).count() == old_user_count
        assert db.query(models.RoomArea).count() == old_room_count + 8
        assert db.query(models.RoomArea).filter_by(name="Old training room").count() == 1
        solace = db.query(models.RoomArea).filter_by(name="Solace").one()
        perch = db.query(models.RoomArea).filter_by(name="Perch 1").one()
        first = db.query(models.GuestNote).filter_by(title="[TRAINING] Solace AC not cooling").one()
        second = db.query(models.GuestNote).filter_by(title="[TRAINING] Perch 1 towel request").one()
        assert (first.room_area_id, first.status) == (solace.id, "Follow")
        assert (second.room_area_id, second.status) == (perch.id, "Open")
        first.status = "Done"
        db.commit()
    assert ensure_room_practice_data(db_file, state) == 0
    with Session() as db:
        assert db.query(models.GuestNote).filter_by(title="[TRAINING] Solace AC not cooling").one().status == "Done"


@pytest.mark.parametrize("bad_setting", [
    ("ENVIRONMENT", "production"),
    ("ALLOW_DEMO_SEED", "true"),
    ("ALLOW_DEFAULT_ADMIN_BOOTSTRAP", "true"),
    ("DATABASE_URL", "sqlite:////tmp/unrelated.sqlite"),
])
def test_upgrade_rejects_unsafe_configuration_without_writing(isolated_desktop, monkeypatch, bad_setting):
    state, db_file, Session = isolated_desktop
    monkeypatch.setenv(*bad_setting)
    with pytest.raises(SystemExit, match="REFUSED"):
        ensure_room_practice_data(db_file, state)
    with Session() as db:
        assert db.query(models.RoomArea).count() == 1
        assert db.query(models.GuestNote).count() == 0


def test_upgrade_rejects_unexpected_account(isolated_desktop):
    state, db_file, Session = isolated_desktop
    with Session() as db:
        db.add(models.User(name="Not a trainer", email="unapproved@example.org",
                           role="staff", department_id=db.query(models.Department).filter_by(name="Front Desk").one().id,
                           is_active=True))
        db.commit()
    with pytest.raises(SystemExit, match="REFUSED"):
        ensure_room_practice_data(db_file, state)
    with Session() as db:
        assert db.query(models.RoomArea).count() == 1
