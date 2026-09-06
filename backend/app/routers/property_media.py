from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Session

from ..clock import UTCDateTime as DateTime, utc_now
from ..database import Base, get_db
from ..upload_safety import safe_original_filename, validate_upload_content
from .api import UPLOAD_DIR, require_user

router = APIRouter(prefix="/api/property-media", tags=["property-media"])

ALLOWED_SLOTS = {
    "login_background": "Login background",
    "dashboard_hero": "Dashboard hero",
    "property_cover": "Property cover",
    "room_placeholder": "Default room placeholder",
}
IMAGE_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
MAX_UPLOAD_BYTES = min(int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))), 10 * 1024 * 1024)
COPY_CHUNK_BYTES = 1024 * 1024
STORAGE_PREFIX = "property-media:"


class PropertyMedia(Base):
    __tablename__ = "property_media"

    id = Column(Integer, primary_key=True)
    slot = Column(String(60), unique=True, nullable=False)
    filename = Column(String(220), nullable=False)
    file_url = Column(Text, nullable=False)
    mime_type = Column(String(120), nullable=True)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)


def _require_owner(user):
    if str(user.role or "").lower() != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can change property appearance media.")
    return user


def _slot(value: str) -> str:
    if value not in ALLOWED_SLOTS:
        raise HTTPException(status_code=404, detail="Unknown property media slot.")
    return value


def _stored_path(file_url: str | None) -> Path | None:
    value = (file_url or "").strip()
    if not value.startswith(STORAGE_PREFIX):
        return None
    name = value.removeprefix(STORAGE_PREFIX)
    if not name or Path(name).name != name:
        return None
    target = (UPLOAD_DIR / name).resolve()
    root = UPLOAD_DIR.resolve()
    if target.parent != root:
        return None
    return target


def _public_row(slot: str, row: PropertyMedia | None) -> dict:
    return {
        "slot": slot,
        "label": ALLOWED_SLOTS[slot],
        "configured": bool(row),
        "content_url": f"/api/property-media/{slot}/content" if row else None,
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def _owner_row(slot: str, row: PropertyMedia | None) -> dict:
    value = _public_row(slot, row)
    value["filename"] = row.filename if row else None
    value["mime_type"] = row.mime_type if row else None
    return value


@router.get("")
def list_property_media(response: Response, db: Session = Depends(get_db)):
    rows = {row.slot: row for row in db.query(PropertyMedia).all() if row.slot in ALLOWED_SLOTS}
    response.headers["Cache-Control"] = "no-store"
    return [_public_row(slot, rows.get(slot)) for slot in ALLOWED_SLOTS]


@router.get("/{slot}/content")
def property_media_content(slot: str, db: Session = Depends(get_db)):
    slot = _slot(slot)
    row = db.query(PropertyMedia).filter(PropertyMedia.slot == slot).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Property media is not configured.")
    target = _stored_path(row.file_url)
    if target is None or not target.is_file():
        raise HTTPException(status_code=404, detail="Stored property media was not found.")
    suffix = Path(row.filename).suffix.lower()
    public_name = f"hidden-oasis-{slot.replace('_', '-')}{suffix if suffix in IMAGE_MIME_BY_SUFFIX else ''}"
    return FileResponse(
        target,
        media_type=row.mime_type or "application/octet-stream",
        filename=public_name,
        content_disposition_type="inline",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/{slot}")
def replace_property_media(
    slot: str,
    file: UploadFile = File(...),
    user=Depends(require_user),
    db: Session = Depends(get_db),
):
    _require_owner(user)
    slot = _slot(slot)
    try:
        original = safe_original_filename(file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    suffix = Path(original).suffix.lower()
    if suffix not in IMAGE_MIME_BY_SUFFIX:
        raise HTTPException(status_code=400, detail="Property media must be a PNG, JPEG, WebP, or GIF image.")
    supplied_mime = (file.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if supplied_mime != "application/octet-stream" and not supplied_mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Property media must use an image MIME type.")
    stored_mime = IMAGE_MIME_BY_SUFFIX[suffix]

    stored_name = f"property_{slot}_{int(time.time())}_{uuid.uuid4().hex[:12]}{suffix}"
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
                        raise HTTPException(status_code=400, detail=str(exc)) from exc
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Property image is too large.")
                buffer.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Property image is empty.")

        row = db.query(PropertyMedia).filter(PropertyMedia.slot == slot).one_or_none()
        old_path = _stored_path(row.file_url) if row else None
        if row is None:
            row = PropertyMedia(slot=slot, filename=original, file_url=f"{STORAGE_PREFIX}{stored_name}", mime_type=stored_mime, updated_by_id=user.id)
            db.add(row)
        else:
            row.filename = original
            row.file_url = f"{STORAGE_PREFIX}{stored_name}"
            row.mime_type = stored_mime
            row.updated_by_id = user.id
        db.commit()
        db.refresh(row)
        if old_path is not None and old_path != target:
            old_path.unlink(missing_ok=True)
        return _owner_row(slot, row)
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        raise


@router.delete("/{slot}", status_code=204)
def reset_property_media(slot: str, user=Depends(require_user), db: Session = Depends(get_db)):
    _require_owner(user)
    slot = _slot(slot)
    row = db.query(PropertyMedia).filter(PropertyMedia.slot == slot).one_or_none()
    if row is None:
        return None
    old_path = _stored_path(row.file_url)
    db.delete(row)
    db.commit()
    if old_path is not None:
        old_path.unlink(missing_ok=True)
    return None
