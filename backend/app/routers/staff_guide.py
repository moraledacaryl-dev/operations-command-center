"""Controlled staff guide, published revision and acknowledgment APIs."""
from __future__ import annotations

from datetime import datetime, timedelta
import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from .. import foundation_models as foundation
from ..authorization_policy import department_ids_for
from ..clock import utc_now
from ..handbook_parser import parse_handbook_pdf, MAX_BYTES
from ..database import get_db
from ..services.notifications import notify_user
from ..staff_guide_models import (
    GuideDocument, GuideRevision, GuideRevisionDepartment,
    GuideAcknowledgment, GuideReading,
)
from ..staff_guide_service import (
    can_author, can_view_revision, check_draft_scope, eligible_users,
    is_publisher, visible_guide_query,
)
from ..utils import model_to_dict
from .api import require_user
from .uploads_hardened import _store_upload, _download_response, require_download_user

router = APIRouter(prefix="/api/staff-guide", tags=["staff-guide"])
DocumentType = Literal["SOP", "Policy", "Quick Guide", "Emergency"]
Audience = Literal["all", "departments", "management"]
MANAGER_ROLES = {"owner", "admin", "manager"}


class DraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=180)
    doc_type: DocumentType = "Quick Guide"
    category: str = Field(default="General", min_length=1, max_length=80)
    summary: str = Field(default="", max_length=1000)
    body: str = Field(min_length=1, max_length=40000)
    audience: Audience = "departments"
    department_ids: list[int] = Field(default_factory=list, max_length=30)
    requires_ack: bool = False
    effective_at: datetime | None = None
    review_at: datetime | None = None


class EditPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=3, max_length=180)
    doc_type: DocumentType | None = None
    category: str | None = Field(default=None, min_length=1, max_length=80)
    summary: str | None = Field(default=None, max_length=1000)
    body: str | None = Field(default=None, min_length=1, max_length=40000)
    audience: Audience | None = None
    department_ids: list[int] | None = Field(default=None, max_length=30)
    requires_ack: bool | None = None
    effective_at: datetime | None = None
    review_at: datetime | None = None


class PublishPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    due_days: int = Field(default=7, ge=1, le=90)


def _find(db: Session, document_id: int, lock: bool = False) -> GuideDocument:
    query = db.query(GuideDocument).filter(GuideDocument.id == document_id)
    if lock:
        query = query.with_for_update().populate_existing()
    document = query.one_or_none()
    if document is None:
        raise HTTPException(404, "Guide not found.")
    return document


def _close_review_notifications(db: Session, doc_id: int) -> None:
    # Keep reviewer notices for audit, but remove obsolete approval requests
    # from every reviewer's active inbox once the draft has changed or passed.
    db.query(foundation.Notification).filter(
        foundation.Notification.source_type == "staff-guide-review",
        foundation.Notification.source_id == str(doc_id),
        foundation.Notification.dismissed_at.is_(None),
    ).update({foundation.Notification.dismissed_at: utc_now()}, synchronize_session=False)


def _can_edit(db: Session, user: models.User, doc: GuideDocument) -> bool:
    return can_author(user, doc.audience, list(doc.department_ids or []), db)


def _guide_attachments(db: Session, parent_type: str, parent_id: int) -> list[dict]:
    rows = (db.query(models.Attachment)
        .filter_by(parent_type=parent_type, parent_id=parent_id)
        .order_by(models.Attachment.id).all())
    return [{"id": row.id, "filename": row.filename, "mime_type": row.mime_type,
             "download_url": "/api/staff-guide/attachments/" + str(row.id) + "/download"}
            for row in rows]


def _revision_data(revision: GuideRevision, departments: list[int], ack: bool | None = None) -> dict:
    data = model_to_dict(revision)
    data["department_ids"] = departments
    if ack is not None:
        data["acknowledged"] = ack
    return data


def _details(db: Session, doc: GuideDocument, user: models.User, manager: bool = False) -> dict:
    result = {"id": doc.id, "status": doc.status, "version": doc.version}
    rev = db.get(GuideRevision, doc.current_revision_id) if doc.current_revision_id else None
    if rev:
        dept = [r.department_id for r in db.query(GuideRevisionDepartment)
                .filter(GuideRevisionDepartment.revision_id == rev.id).all()]
        ack = db.query(GuideAcknowledgment.id).filter_by(user_id=user.id, revision_id=rev.id).first() is not None
        result["published"] = _revision_data(rev, dept, ack)
        result["published"]["attachments"] = _guide_attachments(db, "staff-guide-revision", rev.id)
    if manager:
        result["draft"] = {
            "title": doc.title, "doc_type": doc.doc_type,
            "category": doc.category, "summary": doc.summary, "body": doc.body,
            "audience": doc.audience, "department_ids": list(doc.department_ids or []),
            "requires_ack": doc.requires_ack, "effective_at": doc.effective_at,
            "review_at": doc.review_at,
        }
        result["approved_by_id"] = doc.approved_by_id
        result["draft_attachments"] = _guide_attachments(db, "staff-guide-draft", doc.id)
    return result


@router.get("")
def list_guides(
    q: str = Query(default="", max_length=120),
    doc_type: str = Query(default=""),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    query = visible_guide_query(db, user)
    if doc_type:
        query = query.filter(GuideRevision.doc_type == doc_type)
    term = q.strip()
    if term:
        pattern = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.filter(or_(
            GuideRevision.title.ilike(pattern, escape="\\"),
            GuideRevision.summary.ilike(pattern, escape="\\"),
            GuideRevision.category.ilike(pattern, escape="\\"),
            GuideRevision.body.ilike(pattern, escape="\\"),
        ))
    # What is New must use publication time; an updated old document can be
    # more recent than a newly created one.
    docs = query.order_by(GuideRevision.published_at.desc(), GuideDocument.id.desc()).limit(250).all()
    results = []
    for doc in docs:
        revision = db.get(GuideRevision, doc.current_revision_id)
        results.append({
            "id": doc.id, "title": revision.title, "summary": revision.summary,
            "doc_type": revision.doc_type, "category": revision.category,
            "version": revision.version, "published_at": revision.published_at,
            "requires_ack": revision.requires_ack,
        })
    return results


@router.get("/mine")
def my_reading(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    # Visibility includes newly assigned staff immediately, even before the
    # daily reminder job creates their reading assignment and notification.
    documents = visible_guide_query(db, user).all()
    readings = {reading.revision_id: reading for reading in
                db.query(GuideReading).filter_by(user_id=user.id).all()}
    acknowledged = {value for (value,) in db.query(GuideAcknowledgment.revision_id)
                    .filter(GuideAcknowledgment.user_id == user.id).all()}
    result = []
    memberships = department_ids_for(db, user)
    publisher = is_publisher(user)
    for doc in documents:
        rev = db.get(GuideRevision, doc.current_revision_id)
        if not rev or not rev.requires_ack:
            continue
        # Management may consult guides in every department, but only their
        # own departments' policies (and all-staff policies) are required reading.
        if rev.audience == "departments" and not publisher:
            targets = {row.department_id for row in db.query(GuideRevisionDepartment)
                       .filter_by(revision_id=rev.id).all()}
            if not memberships.intersection(targets):
                continue
        reading = readings.get(rev.id)
        result.append({
            "document_id": doc.id, "revision_id": rev.id,
            "title": rev.title, "due_at": reading.due_at if reading else None,
            "published_at": rev.published_at,
            "acknowledged": rev.id in acknowledged,
        })
    return sorted(result, key=lambda item: item["revision_id"], reverse=True)


@router.get("/manage")
def manage_guides(user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    if str(user.role or "").lower() not in {"owner", "admin", "manager", "lead", "supervisor"}:
        raise HTTPException(403, "You cannot manage guides.")
    docs = db.query(GuideDocument).filter(GuideDocument.retired_at.is_(None)).order_by(GuideDocument.id.desc()).limit(500).all()
    return [{"id": d.id, "title": d.title, "status": d.status,
             "doc_type": d.doc_type, "version": d.version,
             "audience": d.audience}
            for d in docs if _can_edit(db, user, d)]


@router.post("", status_code=201)
def create_guide(payload: DraftPayload, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    values = payload.model_dump()
    values["title"] = values["title"].strip()
    values["body"] = values["body"].strip()
    if not values["title"] or not values["body"]:
        raise HTTPException(422, "A guide needs a title and instructions.")
    check_draft_scope(db, user, values["audience"], values["department_ids"])
    doc = GuideDocument(**values, status="Draft", created_by_id=user.id)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _details(db, doc, user, True)


@router.post("/import-handbook", status_code=201)
def import_handbook_pdf(
    file: UploadFile = File(...),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Privately stage a handbook PDF as a controlled draft for owner approval.

    No real company policy is seeded into the public repository or published
    automatically. Uploads and converted text stay behind guide authorization.
    """
    if not is_publisher(user):
        raise HTTPException(403, "Only authorized management can import the staff handbook.")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(422, "Choose the original handbook PDF.")
    raw = file.file.read(MAX_BYTES + 1)
    try:
        handbook = parse_handbook_pdf(raw)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        file.file.seek(0)

    title = "Hidden Oasis Resort & Restaurant Staff Handbook (2026)"
    source_hash = handbook["source_sha256"]
    data = json.dumps(handbook, ensure_ascii=False, separators=(",", ":"))
    # This is a deliberate owner-only import, not a general uncontrolled
    # /api/docs entry and not a published guide.
    doc = (db.query(GuideDocument)
           .filter(GuideDocument.doc_type == "Handbook",
                   GuideDocument.title == title)
           .with_for_update().one_or_none())
    if doc and doc.retired_at is not None:
        raise HTTPException(409, "The existing handbook is retired. Review it before replacing.")
    if doc:
        try:
            existing = json.loads(doc.body)
        except (ValueError, TypeError):
            existing = {}
        if existing.get("source_sha256") == source_hash:
            return {"id": doc.id, "title": title, "status": doc.status,
                    "already_imported": True,
                    "chapters": len(handbook["chapters"])}
        doc.body = data
        doc.summary = "2026 Staff Handbook — converted from the approved source PDF; review before publishing."
        doc.status = "Draft"
        doc.approved_by_id = None
        doc.requires_ack = True
        doc.audience = "all"
        doc.department_ids = []
        _close_review_notifications(db, doc.id)
        # Historical immutable revision attachments are left untouched.
        db.query(models.Attachment).filter_by(
            parent_type="staff-guide-draft", parent_id=doc.id).delete()
    else:
        doc = GuideDocument(
            title=title, doc_type="Handbook", category="Staff Handbook",
            summary="2026 Staff Handbook — converted from the source PDF; review before publishing.",
            body=data, audience="all", department_ids=[], requires_ack=True,
            status="Draft", created_by_id=user.id)
        db.add(doc)
    db.flush()
    # Retain the original PDF as a private, access-controlled draft attachment
    # so reviewers can compare conversion against the authoritative source.
    original, url, mime, stored_path = _store_upload(file, "handbook_" + str(doc.id))
    try:
        db.add(models.Attachment(
            parent_type="staff-guide-draft", parent_id=doc.id,
            filename=original, file_url=url, mime_type=mime, uploaded_by_id=user.id,
        ))
        db.commit()
    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise
    return {"id": doc.id, "title": title, "status": doc.status,
            "already_imported": False,
            "chapters": len(handbook["chapters"]),
            "subsections": sum(len(ch["sections"]) for ch in handbook["chapters"])}


@router.get("/{document_id}")
def get_guide(document_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    doc = _find(db, document_id)
    manager = _can_edit(db, user, doc)
    if not manager and not can_view_revision(db, user, doc.id):
        raise HTTPException(404, "Guide not found.")
    return _details(db, doc, user, manager)


@router.patch("/{document_id}")
def edit_guide(document_id: int, payload: EditPayload, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    doc = _find(db, document_id, lock=True)
    if doc.retired_at is not None or not _can_edit(db, user, doc):
        raise HTTPException(403, "You cannot edit this guide.")
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return _details(db, doc, user, True)
    if any(value is None for key, value in values.items() if key not in {"effective_at", "review_at"}):
        raise HTTPException(422, "This field cannot be empty.")
    target_audience = values.get("audience", doc.audience)
    target_departments = values.get("department_ids", list(doc.department_ids or []))
    check_draft_scope(db, user, target_audience, target_departments)
    for key, value in values.items():
        setattr(doc, key, value.strip() if isinstance(value, str) else value)
    doc.status = "Draft"
    doc.approved_by_id = None
    _close_review_notifications(db, doc.id)
    db.commit()
    return _details(db, doc, user, True)


@router.post("/{document_id}/submit")
def submit_guide(document_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    doc = _find(db, document_id, lock=True)
    if doc.retired_at is not None or not _can_edit(db, user, doc):
        raise HTTPException(403, "You cannot submit this guide.")
    if doc.status != "Draft":
        raise HTTPException(409, "Edit a draft before submitting for approval.")
    if not (doc.title.strip() and doc.body.strip()):
        raise HTTPException(422, "Add the instructions before submitting.")
    doc.status = "In Review"
    doc.approved_by_id = None
    # Only publisher accounts receive draft titles. Staff never see drafts.
    reviewers = (db.query(models.User).filter(
        models.User.is_active.is_(True),
        models.User.role.in_(("owner", "admin"))).all())
    for reviewer in reviewers:
        notify_user(db, reviewer.id, "staff-guide-review",
                    "Guide needs approval: " + doc.title,
                    "Review this draft before it is published.",
                    source_type="staff-guide-review", source_id=doc.id,
                    action_url="/staff-guide?doc=" + str(doc.id))
    db.commit()
    return {"status": doc.status}


@router.post("/{document_id}/approve")
def approve_guide(document_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    if not is_publisher(user):
        raise HTTPException(403, "Only authorized management can approve guides.")
    doc = _find(db, document_id, lock=True)
    if doc.status != "In Review" or doc.retired_at is not None:
        raise HTTPException(409, "Only guides awaiting review can be approved.")
    check_draft_scope(db, user, doc.audience, list(doc.department_ids or []))
    doc.status = "Approved"
    doc.approved_by_id = user.id
    _close_review_notifications(db, doc.id)
    db.commit()
    return {"status": doc.status}


@router.post("/{document_id}/publish")
def publish_guide(document_id: int, payload: PublishPayload, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    if not is_publisher(user):
        raise HTTPException(403, "Only authorized management can publish guides.")
    doc = _find(db, document_id, lock=True)
    if doc.status != "Approved" or doc.approved_by_id is None or doc.retired_at is not None:
        raise HTTPException(409, "This guide must be approved before publishing.")
    depts = list(doc.department_ids or [])
    check_draft_scope(db, user, doc.audience, depts)
    revision = GuideRevision(
        document_id=doc.id, version=doc.version + 1, title=doc.title,
        doc_type=doc.doc_type, category=doc.category, summary=doc.summary,
        body=doc.body, audience=doc.audience, requires_ack=doc.requires_ack,
        effective_at=doc.effective_at, published_at=utc_now(), published_by_id=user.id,
        approved_by_id=doc.approved_by_id)
    db.add(revision)
    db.flush()
    for department_id in depts:
        db.add(GuideRevisionDepartment(revision_id=revision.id, department_id=department_id))
    # Snapshot the current draft attachments into the immutable revision.
    # Sharing storage is safe: draft removal must never delete published files.
    draft_files = db.query(models.Attachment).filter_by(
        parent_type="staff-guide-draft", parent_id=doc.id).all()
    for item in draft_files:
        db.add(models.Attachment(
            parent_type="staff-guide-revision", parent_id=revision.id,
            filename=item.filename, file_url=item.file_url,
            mime_type=item.mime_type, uploaded_by_id=item.uploaded_by_id))
    doc.current_revision_id = revision.id
    doc.version = revision.version
    doc.status = "Published"
    due = revision.published_at + timedelta(days=payload.due_days)
    for person in eligible_users(db, revision, depts):
        notify_user(db, person.id, "staff-guide",
                    f"{'Updated' if revision.version > 1 else 'New'}: {revision.title}",
                    "Please read this guide." + (" Acknowledgment is required." if revision.requires_ack else ""),
                    source_type="staff-guide", source_id=doc.id,
                    action_url=f"/staff-guide?doc={doc.id}")
        if revision.requires_ack:
            db.add(GuideReading(user_id=person.id, revision_id=revision.id, due_at=due))
    db.commit()
    return {"id": doc.id, "version": revision.version, "status": doc.status}


@router.get("/{document_id}/history")
def guide_history(document_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    doc = _find(db, document_id)
    if not _can_edit(db, user, doc):
        raise HTTPException(404, "Guide not found.")
    revisions = db.query(GuideRevision).filter_by(document_id=doc.id).order_by(GuideRevision.version.desc()).all()
    actor_ids = {item for revision in revisions for item in (revision.published_by_id, revision.approved_by_id)}
    names = dict(db.query(models.User.id, models.User.name).filter(models.User.id.in_(actor_ids)).all())
    return [{
        "id": revision.id, "version": revision.version, "title": revision.title,
        "published_at": revision.published_at,
        "published_by_name": names.get(revision.published_by_id, "Former employee"),
        "approved_by_name": names.get(revision.approved_by_id, "Former employee"),
        "summary": revision.summary, "body": revision.body,
        "doc_type": revision.doc_type, "category": revision.category,
    } for revision in revisions]


@router.post("/{document_id}/acknowledge")
def acknowledge_guide(document_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    doc = _find(db, document_id, lock=True)
    if not can_view_revision(db, user, doc.id):
        raise HTTPException(404, "Guide not found.")
    rev = db.get(GuideRevision, doc.current_revision_id)
    if not rev.requires_ack:
        raise HTTPException(409, "This guide does not require acknowledgment.")
    row = db.query(GuideAcknowledgment).filter_by(user_id=user.id, revision_id=rev.id).first()
    if not row:
        row = GuideAcknowledgment(user_id=user.id, revision_id=rev.id, acknowledged_at=utc_now())
        db.add(row)
        db.commit()
    return {"document_id": doc.id, "revision_id": rev.id, "acknowledged": True,
            "acknowledged_at": row.acknowledged_at}


@router.get("/{document_id}/readers")
def guide_readers(document_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    if str(user.role or "").lower() not in MANAGER_ROLES:
        raise HTTPException(403, "Only management can view reading reports.")
    doc = _find(db, document_id)
    if not _can_edit(db, user, doc) and not is_publisher(user):
        raise HTTPException(404, "Guide not found.")
    if not doc.current_revision_id:
        return []
    rev = db.get(GuideRevision, doc.current_revision_id)
    dept = [row.department_id for row in db.query(GuideRevisionDepartment)
            .filter_by(revision_id=rev.id).all()]
    ack = {a.user_id: a.acknowledged_at for a in db.query(GuideAcknowledgment)
           .filter_by(revision_id=rev.id).all()}
    return [{"user_id": person.id, "name": person.name,
             "acknowledged_at": ack.get(person.id)}
            for person in eligible_users(db, rev, dept)]


@router.post("/{document_id}/retire")
def retire_guide(document_id: int, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    if not is_publisher(user):
        raise HTTPException(403, "Only authorized management can retire guides.")
    doc = _find(db, document_id, lock=True)
    if doc.retired_at is None:
        doc.retired_at = utc_now()
        doc.status = "Retired"
        _close_review_notifications(db, doc.id)
        db.commit()
    return {"status": doc.status}


@router.post("/{document_id}/attachments", status_code=201)
def upload_guide_file(
    document_id: int,
    file: UploadFile = File(...),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    doc = _find(db, document_id, lock=True)
    if doc.retired_at is not None or not _can_edit(db, user, doc):
        raise HTTPException(403, "You cannot add files to this guide.")
    original, saved_url, mime, stored_path = _store_upload(file, "guide_" + str(doc.id))
    try:
        attachment = models.Attachment(
            parent_type="staff-guide-draft", parent_id=doc.id,
            filename=original, file_url=saved_url, mime_type=mime, uploaded_by_id=user.id)
        db.add(attachment)
        doc.status = "Draft"
        doc.approved_by_id = None
        db.commit()
        db.refresh(attachment)
    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise
    return {"id": attachment.id, "filename": attachment.filename,
            "download_url": "/api/staff-guide/attachments/" + str(attachment.id) + "/download"}


@router.delete("/{document_id}/attachments/{attachment_id}", status_code=204)
def remove_draft_file(
    document_id: int, attachment_id: int,
    user: models.User = Depends(require_user), db: Session = Depends(get_db),
):
    doc = _find(db, document_id, lock=True)
    if doc.retired_at is not None or not _can_edit(db, user, doc):
        raise HTTPException(403, "You cannot change this guide.")
    attachment = db.query(models.Attachment).filter_by(
        id=attachment_id, parent_type="staff-guide-draft", parent_id=doc.id).one_or_none()
    if attachment is None:
        raise HTTPException(404, "File not found.")
    # Keep stored bytes: a previous published revision might still reference them.
    db.delete(attachment)
    doc.status = "Draft"
    doc.approved_by_id = None
    db.commit()


@router.get("/attachments/{attachment_id}/download")
def download_guide_file(
    attachment_id: int,
    user: models.User = Depends(require_download_user),
    db: Session = Depends(get_db),
):
    attachment = db.get(models.Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(404, "File not found.")
    if attachment.parent_type == "staff-guide-revision":
        revision = db.get(GuideRevision, attachment.parent_id)
        if revision is None:
            raise HTTPException(404, "File not found.")
        document = db.get(GuideDocument, revision.document_id)
        if document is None:
            raise HTTPException(404, "File not found.")
        if not (
            (document.current_revision_id == revision.id and can_view_revision(db, user, document.id))
            or _can_edit(db, user, document)
        ):
            raise HTTPException(404, "File not found.")
    elif attachment.parent_type == "staff-guide-draft":
        document = db.get(GuideDocument, attachment.parent_id)
        if document is None or not _can_edit(db, user, document):
            raise HTTPException(404, "File not found.")
    else:
        raise HTTPException(404, "File not found.")
    response = _download_response(attachment.file_url, attachment.filename, attachment.mime_type)
    response.headers["Cache-Control"] = "private, no-store"
    return response
