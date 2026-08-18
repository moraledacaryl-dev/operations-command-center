from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..database import get_db
from ..upload_safety import safe_original_filename, validate_external_url, validate_upload_content
from ..utils import log_activity, model_to_dict
from .api import UPLOAD_DIR, fetch_or_404, get_model, require_user

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
COPY_CHUNK_BYTES = 1024 * 1024
LOCAL_STORAGE_PREFIX = "storage:"


def _http_error(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _safe_external_url(value: str) -> str:
    try:
        return validate_external_url(value)
    except ValueError as exc:
        raise _http_error(exc) from exc


def _safe_filename(value: str) -> str:
    try:
        return safe_original_filename(value)
    except ValueError as exc:
        raise _http_error(exc) from exc


def _store_upload(file: UploadFile, prefix: str) -> tuple[str, str, str | None, Path]:
    original = _safe_filename(file.filename or "")
    suffix = Path(original).suffix.lower()
    stored_name = f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:12]}{suffix}"
    target = UPLOAD_DIR / stored_name
    total = 0
    header = b""

    try:
        with target.open("xb") as buffer:
            while True:
                chunk = file.file.read(COPY_CHUNK_BYTES)
                if not chunk:
                    break
                if not header:
                    header = chunk[:512]
                    try:
                        validate_upload_content(original, file.content_type, header)
                    except ValueError as exc:
                        raise _http_error(exc) from exc
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Uploaded file is too large.")
                buffer.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    except Exception:
        target.unlink(missing_ok=True)
        raise

    return original, f"{LOCAL_STORAGE_PREFIX}{stored_name}", file.content_type or None, target


def _local_path(file_url: str | None) -> Path | None:
    value = (file_url or "").strip()
    if value.startswith(LOCAL_STORAGE_PREFIX):
        name = value.removeprefix(LOCAL_STORAGE_PREFIX)
    elif value.startswith("/uploads/"):
        # Compatibility for files persisted before Pass 3.
        name = value.removeprefix("/uploads/")
    else:
        return None
    if not name or Path(name).name != name:
        raise HTTPException(status_code=404, detail="Stored file not found")
    target = (UPLOAD_DIR / name).resolve()
    upload_root = UPLOAD_DIR.resolve()
    if target.parent != upload_root or not target.is_file():
        raise HTTPException(status_code=404, detail="Stored file not found")
    return target


def _download_response(file_url: str | None, filename: str, mime_type: str | None = None):
    local = _local_path(file_url)
    if local is not None:
        return FileResponse(
            path=local,
            filename=filename,
            media_type=mime_type or "application/octet-stream",
        )
    external = _safe_external_url(file_url or "")
    if external:
        return RedirectResponse(external, status_code=307)
    raise HTTPException(status_code=404, detail="Attachment has no available file")


def _attachment_response(attachment: models.Attachment) -> dict:
    data = model_to_dict(attachment)
    data["file_url"] = f"/api/attachments/{attachment.id}/download"
    return data


def _version_response(version: models.PostVersion) -> dict:
    data = model_to_dict(version)
    data["file_url"] = f"/api/posts/{version.post_id}/versions/{version.id}/download" if version.file_url else None
    return data


@router.post("/{resource}/{item_id}/attachments")
def add_attachment_hardened(
    resource: str,
    item_id: int,
    filename: str = Form(default=""),
    file_url: str = Form(default=""),
    mime_type: str = Form(default=""),
    file: Optional[UploadFile] = File(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    model = get_model(resource)
    obj = fetch_or_404(db, model, item_id)
    authorize_action(db, user, resource, Action.ATTACH, obj=obj)

    saved_url = _safe_external_url(file_url)
    saved_filename = filename.strip()
    saved_mime = mime_type.strip() or None
    stored_path: Path | None = None

    if file is not None and file.filename:
        saved_filename, saved_url, saved_mime, stored_path = _store_upload(file, f"{resource}_{item_id}")
    elif saved_filename:
        saved_filename = _safe_filename(saved_filename)

    if not saved_url:
        raise HTTPException(status_code=400, detail="Attachment needs a file or URL.")

    attachment = models.Attachment(
        parent_type=resource,
        parent_id=item_id,
        filename=saved_filename or saved_url,
        file_url=saved_url,
        mime_type=saved_mime,
        uploaded_by_id=user.id,
    )
    db.add(attachment)
    log_activity(db, resource, item_id, "attachment", f"Attached {attachment.filename}", actor_id=user.id)
    try:
        db.commit()
    except Exception:
        db.rollback()
        if stored_path is not None:
            stored_path.unlink(missing_ok=True)
        raise
    db.refresh(attachment)
    return _attachment_response(attachment)


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    attachment = fetch_or_404(db, models.Attachment, attachment_id)
    model = get_model(attachment.parent_type)
    parent = fetch_or_404(db, model, attachment.parent_id)
    authorize_action(db, user, attachment.parent_type, Action.VIEW, obj=parent)
    return _download_response(attachment.file_url, attachment.filename, attachment.mime_type)


@router.post("/posts/{post_id}/versions")
def add_post_version_hardened(
    post_id: int,
    filename: str = Form(default=""),
    file_url: str = Form(default=""),
    caption_snapshot: str = Form(default=""),
    note: str = Form(default=""),
    uploaded_by_id: Optional[int] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    post = (
        db.query(models.Post)
        .filter(models.Post.id == post_id)
        .with_for_update()
        .one_or_none()
    )
    if post is None:
        raise HTTPException(status_code=404, detail="Not found")
    authorize_action(db, user, "posts", Action.ATTACH, obj=post)

    version_no = int(
        db.query(func.max(models.PostVersion.version_no))
        .filter(models.PostVersion.post_id == post_id)
        .scalar()
        or 0
    ) + 1
    saved_url = _safe_external_url(file_url)
    saved_filename = filename.strip()
    stored_path: Path | None = None

    if file is not None and file.filename:
        saved_filename, saved_url, _, stored_path = _store_upload(file, f"post_{post_id}_v{version_no}")
    elif saved_filename:
        saved_filename = _safe_filename(saved_filename)

    db.query(models.PostVersion).filter(models.PostVersion.post_id == post_id).update(
        {"is_current": False}, synchronize_session=False
    )
    version = models.PostVersion(
        post_id=post_id,
        version_no=version_no,
        filename=saved_filename or f"Version {version_no}",
        file_url=saved_url,
        caption_snapshot=caption_snapshot or post.caption,
        note=note,
        uploaded_by_id=user.id,
        is_current=True,
    )
    post.status = "Review"
    db.add(version)
    log_activity(db, "posts", post_id, "version", f"V{version_no} uploaded", actor_id=user.id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if stored_path is not None:
            stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="A concurrent post version was created; retry the upload.") from exc
    except Exception:
        db.rollback()
        if stored_path is not None:
            stored_path.unlink(missing_ok=True)
        raise
    db.refresh(version)
    return _version_response(version)


@router.get("/posts/{post_id}/versions")
def list_post_versions_hardened(
    post_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    post = fetch_or_404(db, models.Post, post_id)
    authorize_action(db, user, "posts", Action.VIEW, obj=post)
    versions = (
        db.query(models.PostVersion)
        .filter(models.PostVersion.post_id == post_id)
        .order_by(models.PostVersion.version_no.desc())
        .all()
    )
    return [_version_response(version) for version in versions]


@router.get("/posts/{post_id}/versions/{version_id}/download")
def download_post_version(
    post_id: int,
    version_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    post = fetch_or_404(db, models.Post, post_id)
    authorize_action(db, user, "posts", Action.VIEW, obj=post)
    version = (
        db.query(models.PostVersion)
        .filter(models.PostVersion.id == version_id, models.PostVersion.post_id == post_id)
        .one_or_none()
    )
    if version is None:
        raise HTTPException(status_code=404, detail="Post version not found")
    return _download_response(version.file_url, version.filename or f"Version {version.version_no}")
