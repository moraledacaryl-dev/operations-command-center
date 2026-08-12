from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..upload_safety import safe_original_filename, validate_external_url
from ..utils import log_activity, model_to_dict, serialize_many
from .api import (
    UPLOAD_DIR,
    assert_resource_access,
    fetch_or_404,
    get_model,
    require_user,
)

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
COPY_CHUNK_BYTES = 1024 * 1024


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


def _store_upload(file: UploadFile, prefix: str) -> tuple[str, str, str | None]:
    original = _safe_filename(file.filename or "")
    suffix = Path(original).suffix.lower()
    stored_name = f"{prefix}_{int(time.time())}_{uuid.uuid4().hex[:12]}{suffix}"
    target = UPLOAD_DIR / stored_name
    total = 0

    try:
        with target.open("xb") as buffer:
            while True:
                chunk = file.file.read(COPY_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Uploaded file is too large.")
                buffer.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise

    return original, f"/uploads/{stored_name}", file.content_type or None


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
    assert_resource_access(db, user, obj)

    saved_url = _safe_external_url(file_url)
    saved_filename = filename.strip()
    saved_mime = mime_type.strip() or None

    if file is not None and file.filename:
        saved_filename, saved_url, saved_mime = _store_upload(file, f"{resource}_{item_id}")
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
    db.commit()
    db.refresh(attachment)
    return model_to_dict(attachment)


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
    post = fetch_or_404(db, models.Post, post_id)
    assert_resource_access(db, user, post)

    existing = db.query(models.PostVersion).filter(models.PostVersion.post_id == post_id).count()
    version_no = existing + 1
    saved_url = _safe_external_url(file_url)
    saved_filename = filename.strip()

    if file is not None and file.filename:
        saved_filename, saved_url, _ = _store_upload(file, f"post_{post_id}_v{version_no}")
    elif saved_filename:
        saved_filename = _safe_filename(saved_filename)

    db.query(models.PostVersion).filter(models.PostVersion.post_id == post_id).update({"is_current": False})
    version = models.PostVersion(
        post_id=post_id,
        version_no=version_no,
        filename=saved_filename or f"Version {version_no}",
        file_url=saved_url,
        caption_snapshot=caption_snapshot or post.caption,
        note=note,
        # Never trust a multipart actor id supplied by the browser.
        uploaded_by_id=user.id,
        is_current=True,
    )
    post.status = "Review"
    db.add(version)
    log_activity(db, "posts", post_id, "version", f"V{version_no} uploaded", actor_id=user.id)
    db.commit()
    db.refresh(version)
    return model_to_dict(version)


@router.get("/posts/{post_id}/versions")
def list_post_versions_hardened(
    post_id: int,
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    post = fetch_or_404(db, models.Post, post_id)
    assert_resource_access(db, user, post)
    return serialize_many(
        db.query(models.PostVersion)
        .filter(models.PostVersion.post_id == post_id)
        .order_by(models.PostVersion.version_no.desc())
        .all()
    )
