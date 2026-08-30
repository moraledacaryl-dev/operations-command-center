from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.pagination import cursor_page, decode_cursor, decode_history_cursor, encode_cursor, encode_history_cursor


def test_cursor_is_signed_scoped_and_round_trips_utc():
    now = utc_now()
    cursor = encode_cursor("tasks", now, 42)
    timestamp, item_id = decode_cursor("tasks", cursor)
    assert timestamp == now
    assert item_id == 42
    with pytest.raises(HTTPException):
        decode_cursor("posts", cursor)
    with pytest.raises(HTTPException):
        decode_cursor("tasks", cursor[:-1] + ("A" if cursor[-1] != "A" else "B"))


def test_history_cursor_signs_the_full_cross_resource_sort_key():
    now = utc_now()
    cursor = encode_history_cursor(now, "projects", 9)
    assert decode_history_cursor(cursor) == (now, "projects", 9)
    with pytest.raises(HTTPException):
        decode_history_cursor(cursor[:-1] + ("A" if cursor[-1] != "A" else "B"))


def test_stable_cursor_page_has_no_duplicates_or_gaps():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    now = utc_now()
    for index in range(7):
        db.add(models.RoomArea(name=f"Room {index}", kind="room", status="active", updated_at=now - timedelta(minutes=index)))
    db.commit()

    first = cursor_page(db.query(models.RoomArea), models.RoomArea, "rooms", 3)
    second = cursor_page(db.query(models.RoomArea), models.RoomArea, "rooms", 3, first["next_cursor"])
    third = cursor_page(db.query(models.RoomArea), models.RoomArea, "rooms", 3, second["next_cursor"])
    ids = [item["id"] for page in (first, second, third) for item in page["items"]]
    assert len(ids) == 7
    assert len(set(ids)) == 7
    assert first["has_more"] is True
    assert third["has_more"] is False
    assert third["next_cursor"] is None
    db.close()
