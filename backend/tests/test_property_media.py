import base64
import io

import pytest
from fastapi import HTTPException, Response, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app import models
from app.routers import property_media


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def user(db, role: str):
    row = models.User(name=role.title(), email=f"{role}@example.com", role=role, is_active=True)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def image_upload(name="hero.png"):
    return UploadFile(filename=name, file=io.BytesIO(PNG_1X1), headers=Headers({"content-type": "image/png"}))


def public_rows(db):
    response = Response()
    rows = property_media.list_property_media(response, db)
    assert response.headers["cache-control"] == "no-store"
    return rows


def test_property_media_slots_are_fixed_and_public_metadata_is_minimal(db):
    rows = public_rows(db)
    assert [row["slot"] for row in rows] == list(property_media.ALLOWED_SLOTS)
    assert all(row["configured"] is False for row in rows)
    assert all("file_url" not in row for row in rows)
    assert all("filename" not in row for row in rows)
    assert all("mime_type" not in row for row in rows)
    with pytest.raises(HTTPException) as exc:
        property_media._slot("../../arbitrary")
    assert exc.value.status_code == 404


def test_only_owner_can_mutate_property_media(db, tmp_path, monkeypatch):
    monkeypatch.setattr(property_media, "UPLOAD_DIR", tmp_path)
    admin = user(db, "admin")
    with pytest.raises(HTTPException) as exc:
        property_media.replace_property_media("dashboard_hero", image_upload(), admin, db)
    assert exc.value.status_code == 403
    assert not list(tmp_path.iterdir())


def test_owner_upload_replace_and_reset_are_bounded(db, tmp_path, monkeypatch):
    monkeypatch.setattr(property_media, "UPLOAD_DIR", tmp_path)
    owner = user(db, "owner")

    first = property_media.replace_property_media("dashboard_hero", image_upload("first.png"), owner, db)
    assert first["configured"] is True
    assert first["content_url"] == "/api/property-media/dashboard_hero/content"
    assert len(list(tmp_path.iterdir())) == 1

    second = property_media.replace_property_media("dashboard_hero", image_upload("second.png"), owner, db)
    assert second["filename"] == "second.png"
    assert len(list(tmp_path.iterdir())) == 1

    rows = public_rows(db)
    configured = next(row for row in rows if row["slot"] == "dashboard_hero")
    assert configured["configured"] is True
    assert "filename" not in configured
    assert "mime_type" not in configured

    content = property_media.property_media_content("dashboard_hero", db)
    assert content.headers["cache-control"] == "no-cache"
    disposition = content.headers.get("content-disposition", "")
    assert "second.png" not in disposition
    assert "hidden-oasis-dashboard-hero.png" in disposition

    property_media.reset_property_media("dashboard_hero", owner, db)
    assert public_rows(db)[1]["configured"] is False
    assert list(tmp_path.iterdir()) == []


def test_non_image_payload_is_rejected_and_cleaned_up(db, tmp_path, monkeypatch):
    monkeypatch.setattr(property_media, "UPLOAD_DIR", tmp_path)
    owner = user(db, "owner")
    upload = UploadFile(filename="fake.png", file=io.BytesIO(b"not an image"), headers=Headers({"content-type": "image/png"}))
    with pytest.raises(HTTPException) as exc:
        property_media.replace_property_media("login_background", upload, owner, db)
    assert exc.value.status_code == 400
    assert list(tmp_path.iterdir()) == []
