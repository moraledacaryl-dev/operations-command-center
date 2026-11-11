"""Private handbook importer: synthetic PDFs, no resort handbook in public git."""
from __future__ import annotations

import io
import json
from pathlib import Path

import fitz
import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app import foundation_models as fm
from app.handbook_parser import parse_handbook_pdf, SCHEMA
from app.routers import staff_guide as guide
from app.staff_guide_models import GuideDocument, GuideRevision


def fake_pdf(edition="First"):
    document = fitz.open()
    for chapter in (1, 2):
        page = document.new_page(width=596, height=842)
        page.insert_text((242, 148), f"SECTION {chapter}", fontsize=16)
        page.insert_text((135, 178), f"SYNTHETIC CHAPTER {chapter}", fontsize=16)
        for n, top in ((1, 253), (2, 410)):
            page.insert_text((85, top), f"{chapter}.{n} Synthetic Topic {n}", fontsize=12)
            page.insert_text((114, top+26),
                f"{edition} demo-only policy example {chapter}.{n}; do not apply as real staff rules.",
                fontsize=11)
            page.insert_text((114, top+48),
                "This deliberately invented paragraph is solely for automated tests.", fontsize=11)
            page.insert_text((133, top+80),
                "This is a synthetic bullet used only in testing the importer.", fontsize=11)
            page.draw_circle(fitz.Point(125, top+75), 1.6, color=None, fill=(0,0,0))
    raw = document.tobytes()
    document.close()
    return raw


@pytest.fixture
def ctx(monkeypatch, tmp_path):
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    dept = models.Department(name="Demo Team")
    db.add(dept)
    db.flush()
    owner = models.User(name="Demo owner", role="owner", is_active=True)
    staff = models.User(name="Demo staff", role="staff",
                        department_id=dept.id, is_active=True)
    db.add_all([owner, staff])
    db.commit()
    def fake_store(file, prefix):
        path = tmp_path / (prefix + ".pdf")
        path.write_bytes(file.file.read())
        return "sample.pdf", "/uploads/" + path.name, "application/pdf", path
    monkeypatch.setattr(guide, "_store_upload", fake_store)
    yield db, owner, staff
    db.close()
    engine.dispose()


def upload(raw):
    return UploadFile(filename="sample.pdf", file=io.BytesIO(raw))


def test_parse_synthetic_pdf_and_bullets():
    contents = parse_handbook_pdf(fake_pdf())
    assert contents["schema"] == SCHEMA
    assert len(contents["chapters"]) == 2
    assert [c["title"] for c in contents["chapters"]] == [
        "Synthetic Chapter 1", "Synthetic Chapter 2"]
    assert len(contents["chapters"][0]["sections"]) == 2
    paragraph = contents["chapters"][0]["sections"][0]["blocks"]
    assert any("First demo-only" in item.get("text", "") for item in paragraph)
    assert any(item["type"] == "bullets" for item in paragraph)


def test_import_is_draft_and_requires_publisher(ctx):
    db, owner, staff = ctx
    raw = fake_pdf()
    with pytest.raises(HTTPException) as denied:
        guide.import_handbook_pdf(upload(raw), staff, db)
    assert denied.value.status_code == 403
    created = guide.import_handbook_pdf(upload(raw), owner, db)
    assert created["status"] == "Draft"
    assert created["chapters"] == 2
    doc = db.get(GuideDocument, created["id"])
    assert doc.doc_type == "Handbook"
    assert doc.audience == "all"
    assert doc.requires_ack is True
    assert doc.version == 0
    assert json.loads(doc.body)["schema"] == SCHEMA
    assert db.query(fm.Notification).count() == 0
    assert db.query(models.Attachment).count() == 1
    with pytest.raises(HTTPException) as unseen:
        guide.get_guide(doc.id, staff, db)
    assert unseen.value.status_code == 404
    same = guide.import_handbook_pdf(upload(raw), owner, db)
    assert same["already_imported"] is True
    assert db.query(GuideDocument).count() == 1
    assert db.query(models.Attachment).count() == 1


def test_import_revisions_are_separate_from_published_snapshots(ctx):
    db, owner, staff = ctx
    created = guide.import_handbook_pdf(upload(fake_pdf("First")), owner, db)
    doc_id = created["id"]
    guide.submit_guide(doc_id, owner, db)
    guide.approve_guide(doc_id, owner, db)
    published = guide.publish_guide(doc_id, guide.PublishPayload(), owner, db)
    assert published["version"] == 1
    prior = db.query(GuideRevision).filter_by(document_id=doc_id).one()
    saved_body = prior.body
    assert guide.get_guide(doc_id, staff, db)["published"]["body"] == saved_body
    updated = guide.import_handbook_pdf(upload(fake_pdf("Changed")), owner, db)
    assert updated["id"] == doc_id
    assert updated["status"] == "Draft"
    assert prior.body == saved_body
    assert "Changed demo-only" in db.get(GuideDocument, doc_id).body
    assert guide.get_guide(doc_id, staff, db)["published"]["body"] == saved_body
    guide.submit_guide(doc_id, owner, db)
    guide.approve_guide(doc_id, owner, db)
    next_rev = guide.publish_guide(doc_id, guide.PublishPayload(), owner, db)
    assert next_rev["version"] == 2
    assert db.query(GuideRevision).filter_by(document_id=doc_id).count() == 2
    assert prior.body == saved_body


def test_rejects_invalid_or_unreadable_uploads(ctx):
    db, owner, staff = ctx
    for payload in (b"", b"not a pdf", b"%PDF-invalid"):
        with pytest.raises(HTTPException) as bad:
            guide.import_handbook_pdf(upload(payload), owner, db)
        assert bad.value.status_code == 422
    assert db.query(GuideDocument).count() == 0
