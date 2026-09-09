from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import foundation_models as foundation
from .. import models
from ..authorization_policy import Action
from ..database import get_db
from ..utils import log_activity, model_to_dict
from .api import require_user
from .marketing import campaign_or_404
from .marketing import authorize_campaign
from .uploads_hardened import _download_response, _store_upload, require_download_user

router = APIRouter(prefix="/api/marketing", tags=["marketing-assets"])
RELATIONSHIP_TYPE = "creative-asset"
CONCEPT_TYPE = "content-concepts"
ASSET_TYPE = "assets"
STUDIO_ANNOTATION_TYPE = "StudioState"
STUDIO_STATE_MAX_BYTES = 12 * 1024 * 1024


class AnnotationStudioState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    base_version_id: int = Field(gt=0)
    objects: list[dict] = Field(default_factory=list, max_length=500)


def _concept_or_404(db: Session, concept_id: int) -> foundation.ContentConcept:
    concept = db.get(foundation.ContentConcept, concept_id)
    if concept is None:
        raise HTTPException(status_code=404, detail="Content concept not found")
    return concept


def _authorize_concept(db: Session, user: models.User, concept: foundation.ContentConcept, action: Action) -> None:
    campaign = campaign_or_404(db, concept.campaign_id)
    authorize_campaign(db, user, campaign, action)


def _asset_concept(db: Session, asset_id: int) -> foundation.ContentConcept:
    relationship = (
        db.query(foundation.RecordRelationship)
        .filter(
            foundation.RecordRelationship.from_type == CONCEPT_TYPE,
            foundation.RecordRelationship.to_type == ASSET_TYPE,
            foundation.RecordRelationship.to_id == str(asset_id),
            foundation.RecordRelationship.relationship_type == RELATIONSHIP_TYPE,
        )
        .one_or_none()
    )
    if relationship is None:
        raise HTTPException(status_code=404, detail="Marketing creative asset not found")
    try:
        concept_id = int(relationship.from_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Marketing creative asset not found") from exc
    return _concept_or_404(db, concept_id)


def _asset_version_or_404(db: Session, asset_id: int, version_id: int) -> foundation.AssetVersion:
    version = (
        db.query(foundation.AssetVersion)
        .filter(foundation.AssetVersion.id == version_id, foundation.AssetVersion.asset_id == asset_id)
        .one_or_none()
    )
    if version is None:
        raise HTTPException(status_code=404, detail="Creative version not found")
    return version


def _version_payload(version: foundation.AssetVersion) -> dict:
    data = model_to_dict(version)
    data["file_url"] = f"/api/marketing/assets/{version.asset_id}/versions/{version.id}/download"
    data["annotatable"] = (version.mime_type or "").lower() in {"image/png", "image/jpeg", "image/webp"}
    return data


def _asset_payload(db: Session, asset: foundation.Asset) -> dict:
    versions = (
        db.query(foundation.AssetVersion)
        .filter(foundation.AssetVersion.asset_id == asset.id)
        .order_by(foundation.AssetVersion.version_no.desc())
        .all()
    )
    data = model_to_dict(asset)
    data["versions"] = [_version_payload(version) for version in versions]
    return data


@router.get("/concepts/{concept_id}/assets")
def list_concept_assets(
    concept_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    concept = _concept_or_404(db, concept_id)
    _authorize_concept(db, user, concept, Action.VIEW)
    asset_ids = [
        int(value)
        for (value,) in db.query(foundation.RecordRelationship.to_id)
        .filter(
            foundation.RecordRelationship.from_type == CONCEPT_TYPE,
            foundation.RecordRelationship.from_id == str(concept_id),
            foundation.RecordRelationship.to_type == ASSET_TYPE,
            foundation.RecordRelationship.relationship_type == RELATIONSHIP_TYPE,
        )
        .all()
        if str(value).isdigit()
    ]
    if not asset_ids:
        return []
    assets = db.query(foundation.Asset).filter(foundation.Asset.id.in_(asset_ids)).order_by(foundation.Asset.updated_at.desc()).all()
    return [_asset_payload(db, asset) for asset in assets]


@router.post("/concepts/{concept_id}/assets")
def create_concept_asset(
    concept_id: int,
    title: str = Form(default=""),
    note: str = Form(default=""),
    file: UploadFile = File(...),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    concept = _concept_or_404(db, concept_id)
    _authorize_concept(db, user, concept, Action.ATTACH)
    saved_filename, storage_key, mime_type, stored_path = _store_upload(file, f"concept_{concept_id}_creative")
    try:
        asset = foundation.Asset(
            deliverable_id=None,
            title=title.strip() or saved_filename,
            asset_type="Creative",
            status="Active",
        )
        db.add(asset)
        db.flush()
        relationship = foundation.RecordRelationship(
            from_type=CONCEPT_TYPE,
            from_id=str(concept_id),
            to_type=ASSET_TYPE,
            to_id=str(asset.id),
            relationship_type=RELATIONSHIP_TYPE,
            created_by_id=user.id,
        )
        version = foundation.AssetVersion(
            asset_id=asset.id,
            version_no=1,
            filename=saved_filename,
            storage_key=storage_key,
            mime_type=mime_type,
            size_bytes=stored_path.stat().st_size,
            uploaded_by_id=user.id,
            note=note.strip() or None,
        )
        db.add(relationship)
        db.add(version)
        db.flush()
        asset.current_version_id = version.id
        log_activity(db, "content-concepts", concept_id, "creative-uploaded", f"Uploaded {saved_filename}", actor_id=user.id, metadata={"asset_id": asset.id, "version_id": version.id})
        db.commit()
    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise
    db.refresh(asset)
    return _asset_payload(db, asset)


@router.post("/assets/{asset_id}/versions")
def add_asset_version(
    asset_id: int,
    note: str = Form(default=""),
    file: UploadFile = File(...),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    asset = db.query(foundation.Asset).filter(foundation.Asset.id == asset_id).with_for_update().one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Marketing creative asset not found")
    concept = _asset_concept(db, asset_id)
    _authorize_concept(db, user, concept, Action.ATTACH)
    version_no = int(db.query(func.max(foundation.AssetVersion.version_no)).filter(foundation.AssetVersion.asset_id == asset_id).scalar() or 0) + 1
    saved_filename, storage_key, mime_type, stored_path = _store_upload(file, f"asset_{asset_id}_v{version_no}")
    version = foundation.AssetVersion(
        asset_id=asset_id,
        version_no=version_no,
        filename=saved_filename,
        storage_key=storage_key,
        mime_type=mime_type,
        size_bytes=stored_path.stat().st_size,
        uploaded_by_id=user.id,
        note=note.strip() or None,
    )
    db.add(version)
    try:
        db.flush()
        asset.current_version_id = version.id
        log_activity(db, "content-concepts", concept.id, "creative-version", f"Created creative version {version_no}", actor_id=user.id, metadata={"asset_id": asset_id, "version_id": version.id})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="A concurrent creative version was created; retry the upload.") from exc
    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise
    db.refresh(version)
    return _version_payload(version)


@router.get("/assets/{asset_id}/versions")
def list_asset_versions(
    asset_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    asset = db.get(foundation.Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Marketing creative asset not found")
    concept = _asset_concept(db, asset_id)
    _authorize_concept(db, user, concept, Action.VIEW)
    rows = db.query(foundation.AssetVersion).filter(foundation.AssetVersion.asset_id == asset_id).order_by(foundation.AssetVersion.version_no.desc()).all()
    return [_version_payload(row) for row in rows]


@router.get("/assets/{asset_id}/versions/{version_id}/annotation-state")
def get_annotation_studio_state(
    asset_id: int,
    version_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    asset = db.get(foundation.Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Marketing creative asset not found")
    concept = _asset_concept(db, asset_id)
    _authorize_concept(db, user, concept, Action.VIEW)
    version = _asset_version_or_404(db, asset_id, version_id)
    annotation = (
        db.query(foundation.Annotation)
        .filter(
            foundation.Annotation.asset_version_id == version.id,
            foundation.Annotation.annotation_type == STUDIO_ANNOTATION_TYPE,
        )
        .order_by(foundation.Annotation.id.desc())
        .first()
    )
    if annotation is None:
        return AnnotationStudioState(base_version_id=version.id, objects=[]).model_dump()
    try:
        return AnnotationStudioState.model_validate_json(annotation.drawing_json or "{}").model_dump()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Stored Annotation Studio state is invalid.") from exc


@router.put("/assets/{asset_id}/versions/{version_id}/annotation-state")
def save_annotation_studio_state(
    asset_id: int,
    version_id: int,
    payload: AnnotationStudioState,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    asset = db.get(foundation.Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Marketing creative asset not found")
    concept = _asset_concept(db, asset_id)
    _authorize_concept(db, user, concept, Action.ATTACH)
    version = _asset_version_or_404(db, asset_id, version_id)
    _asset_version_or_404(db, asset_id, payload.base_version_id)
    serialized = json.dumps(payload.model_dump(), ensure_ascii=False, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > STUDIO_STATE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Editable annotation state is too large to save.")
    annotation = (
        db.query(foundation.Annotation)
        .filter(
            foundation.Annotation.asset_version_id == version.id,
            foundation.Annotation.annotation_type == STUDIO_ANNOTATION_TYPE,
        )
        .order_by(foundation.Annotation.id.desc())
        .first()
    )
    if annotation is None:
        annotation = foundation.Annotation(
            asset_version_id=version.id,
            author_id=user.id,
            annotation_type=STUDIO_ANNOTATION_TYPE,
            drawing_json=serialized,
            body="Annotation Studio editable state",
            status="Open",
        )
        db.add(annotation)
    else:
        annotation.author_id = user.id
        annotation.drawing_json = serialized
    log_activity(
        db,
        "asset-versions",
        version.id,
        "annotation-state-saved",
        "Saved editable Annotation Studio state",
        actor_id=user.id,
        metadata={"asset_id": asset_id, "object_count": len(payload.objects), "base_version_id": payload.base_version_id},
    )
    db.commit()
    return payload.model_dump()


@router.get("/assets/{asset_id}/versions/{version_id}/download")
def download_asset_version(
    asset_id: int,
    version_id: int,
    user: models.User = Depends(require_download_user),
    db: Session = Depends(get_db),
):
    asset = db.get(foundation.Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Marketing creative asset not found")
    concept = _asset_concept(db, asset_id)
    _authorize_concept(db, user, concept, Action.VIEW)
    version = _asset_version_or_404(db, asset_id, version_id)
    return _download_response(version.storage_key, version.filename, version.mime_type)
