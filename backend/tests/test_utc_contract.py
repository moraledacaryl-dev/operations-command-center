from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.utils import model_to_dict, parse_datetime


def test_utc_clock_and_api_serialization_are_explicit():
    now = utc_now()
    assert now.tzinfo == timezone.utc
    assert model_to_dict(models.RoomArea(name="Room", created_at=now, updated_at=now))["created_at"].endswith("Z")
    assert parse_datetime("2026-08-30T12:00:00+08:00") == datetime(2026, 8, 30, 4, 0, tzinfo=timezone.utc)


def test_sqlite_round_trip_restores_utc_timezone():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    room = models.RoomArea(name="Room", kind="room", status="active")
    db.add(room)
    db.commit()
    db.refresh(room)
    assert room.created_at.tzinfo == timezone.utc
    db.close()
