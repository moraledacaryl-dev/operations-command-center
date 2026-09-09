from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app import foundation_models as foundation
from app import models
from app.routers.marketing_assets import (
    AnnotationStudioState,
    add_asset_version,
    create_concept_asset,
    get_annotation_studio_state,
    list_asset_versions,
    list_concept_assets,
    save_annotation_studio_state,
)


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


def test_annotation_studio_state_round_trips_on_saved_version(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened
    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)
    _owner, lead, _outsider, concept = seed(db)
    asset = create_concept_asset(concept.id, title="Hero", note="", file=png_upload(), user=lead, db=db)
    base_version_id = asset["versions"][0]["id"]
    created = add_asset_version(asset["id"], note="Annotated", file=png_upload("annotated.png"), user=lead, db=db)

    empty = get_annotation_studio_state(asset["id"], created["id"], user=lead, db=db)
    assert empty == {"schema_version": 1, "base_version_id": created["id"], "objects": []}

    payload = AnnotationStudioState(
        base_version_id=base_version_id,
        objects=[
            {"id": "text-1", "type": "text", "x": 120, "y": 80, "text": "Move me", "fontSize": 48, "color": "#ef4444", "opacity": 1},
            {"id": "box-1", "type": "rect", "x": 20, "y": 30, "width": 100, "height": 60, "strokeWidth": 6, "color": "#2563eb", "opacity": 1},
        ],
    )
    saved = save_annotation_studio_state(asset["id"], created["id"], payload, user=lead, db=db)
    assert saved == payload.model_dump()
    restored = get_annotation_studio_state(asset["id"], created["id"], user=lead, db=db)
    assert restored == payload.model_dump()
    assert db.query(foundation.Annotation).filter(foundation.Annotation.asset_version_id == created["id"]).count() == 1

    replacement = AnnotationStudioState(base_version_id=base_version_id, objects=[{"id": "text-2", "type": "text"}])
    save_annotation_studio_state(asset["id"], created["id"], replacement, user=lead, db=db)
    assert get_annotation_studio_state(asset["id"], created["id"], user=lead, db=db) == replacement.model_dump()
    assert db.query(foundation.Annotation).filter(foundation.Annotation.asset_version_id == created["id"]).count() == 1


def test_annotation_state_base_version_must_belong_to_same_asset(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened
    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)
    owner, lead, _outsider, concept = seed(db)
    first = create_concept_asset(concept.id, title="First", note="", file=png_upload("first.png"), user=lead, db=db)
    second = create_concept_asset(concept.id, title="Second", note="", file=png_upload("second.png"), user=owner, db=db)
    target_version = first["versions"][0]["id"]
    foreign_base = second["versions"][0]["id"]

    with pytest.raises(HTTPException) as exc:
        save_annotation_studio_state(
            first["id"],
            target_version,
            AnnotationStudioState(base_version_id=foreign_base, objects=[]),
            user=lead,
            db=db,
        )
    assert exc.value.status_code == 404


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

    version_id = asset["versions"][0]["id"]
    with pytest.raises(HTTPException) as exc:
        get_annotation_studio_state(asset["id"], version_id, user=outsider, db=db)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        save_annotation_studio_state(
            asset["id"],
            version_id,
            AnnotationStudioState(base_version_id=version_id, objects=[]),
            user=outsider,
            db=db,
        )
    assert exc.value.status_code == 403
    assert len(list(tmp_path.iterdir())) == 1
