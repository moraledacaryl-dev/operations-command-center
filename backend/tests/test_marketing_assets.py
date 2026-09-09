from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app import foundation_models as foundation
from app import models
from app.routers.marketing_assets import add_asset_version, create_concept_asset, list_asset_versions, list_concept_assets


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()


def seed(db):
    marketing = models.Department(name="Marketing")
    other_department = models.Department(name="Other")
    db.add_all([marketing, other_department]); db.flush()
    owner = models.User(name="Owner", email="owner@example.com", role="owner", department_id=marketing.id, is_active=True)
    lead = models.User(name="Marketing Lead", email="lead@example.com", role="lead", department_id=marketing.id, is_active=True)
    outsider = models.User(name="Other Lead", email="other@example.com", role="lead", department_id=other_department.id, is_active=True)
    db.add_all([owner, lead, outsider]); db.flush()
    db.add_all([
        models.UserDepartment(user_id=lead.id, department_id=marketing.id, is_primary=True),
        models.UserDepartment(user_id=outsider.id, department_id=other_department.id, is_primary=True),
    ])
    campaign = foundation.MarketingCampaign(department_id=marketing.id, name="Direct booking", owner_id=owner.id)
    db.add(campaign); db.flush()
    concept = foundation.ContentConcept(campaign_id=campaign.id, title="Poolside afternoon", content_pillar="Experience", owner_id=lead.id)
    db.add(concept); db.flush()
    db.add_all([
        foundation.PlatformDeliverable(concept_id=concept.id, platform="Facebook", format="Static", assigned_to_id=lead.id),
        foundation.PlatformDeliverable(concept_id=concept.id, platform="Instagram", format="Static", assigned_to_id=lead.id),
    ])
    db.commit()
    return owner, lead, outsider, concept


def png_upload(name="creative.png"):
    return UploadFile(filename=name, file=BytesIO(b"\x89PNG\r\n\x1a\n" + b"creative"), headers=Headers({"content-type": "image/png"}))


def test_concept_creative_upload_is_versioned_and_shared_across_deliverables(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened
    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)
    _owner, lead, _outsider, concept = seed(db)

    asset = create_concept_asset(concept.id, title="Hero creative", note="Original", file=png_upload(), user=lead, db=db)
    assert asset["title"] == "Hero creative"
    assert len(asset["versions"]) == 1
    assert asset["versions"][0]["version_no"] == 1
    assert asset["versions"][0]["annotatable"] is True

    listed = list_concept_assets(concept.id, user=lead, db=db)
    assert [row["id"] for row in listed] == [asset["id"]]
    assert len(db.query(foundation.Asset).all()) == 1
    assert db.query(foundation.PlatformDeliverable).filter(foundation.PlatformDeliverable.concept_id == concept.id).count() == 2

    second = add_asset_version(asset["id"], note="Annotated", file=png_upload("creative-annotated.png"), user=lead, db=db)
    assert second["version_no"] == 2
    versions = list_asset_versions(asset["id"], user=lead, db=db)
    assert [row["version_no"] for row in versions] == [2, 1]
    stored = list(tmp_path.iterdir())
    assert len(stored) == 2


def test_cross_department_user_cannot_read_or_version_concept_creative(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened
    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)
    owner, _lead, outsider, concept = seed(db)
    asset = create_concept_asset(concept.id, title="Scoped creative", note="", file=png_upload(), user=owner, db=db)

    with pytest.raises(HTTPException) as exc:
        list_concept_assets(concept.id, user=outsider, db=db)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        add_asset_version(asset["id"], note="blocked", file=png_upload("blocked.png"), user=outsider, db=db)
    assert exc.value.status_code == 403
    assert len(list(tmp_path.iterdir())) == 1
