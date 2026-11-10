"""Access checks for controlled staff guidance.

A document's working copy may be a draft while its previously published
revision remains visible to staff. Never authorize staff using draft fields.
"""
from fastapi import HTTPException
from sqlalchemy import and_, literal, or_, select
from sqlalchemy.orm import Session

from . import models
from .authorization_policy import department_ids_for
from .staff_guide_models import GuideDocument, GuideRevision, GuideRevisionDepartment

MANAGEMENT = {"owner", "admin", "manager"}
PUBLISHERS = {"owner", "admin"}
EDITORS = MANAGEMENT | {"lead", "supervisor"}


def is_publisher(user: models.User) -> bool:
    return str(user.role or "").lower() in PUBLISHERS


def can_author(user: models.User, audience: str, departments: list[int], db: Session) -> bool:
    role = str(user.role or "").lower()
    if role in PUBLISHERS:
        return True
    if role == "manager":
        return audience == "departments"
    if role in {"lead", "supervisor"}:
        return audience == "departments" and bool(departments) and set(departments).issubset(department_ids_for(db, user))
    return False


def check_draft_scope(db: Session, user: models.User, audience: str, departments: list[int]) -> None:
    if audience == "departments":
        if not departments or len(departments) != len(set(departments)):
            raise HTTPException(422, "Select at least one department, without duplicates.")
        existing = db.query(models.Department.id).filter(models.Department.id.in_(departments)).count()
        if existing != len(departments):
            raise HTTPException(422, "One or more departments do not exist.")
    elif departments:
        raise HTTPException(422, "Department selection is only for department guides.")
    if not can_author(user, audience, departments, db):
        raise HTTPException(403, "You cannot edit guides for this audience.")


def visible_guide_query(db: Session, user: models.User):
    """SQL-side visibility; safe to compose into notification existence checks."""
    document = GuideDocument
    revision = GuideRevision
    query = (db.query(document)
        .join(revision, document.current_revision_id == revision.id)
        .filter(document.retired_at.is_(None)))
    if str(user.role or "").lower() in MANAGEMENT:
        return query
    # Membership remains a SQL subquery so notification pagination and counts
    # do not issue per-user/per-notification lookups.
    ids = select(models.UserDepartment.department_id).where(models.UserDepartment.user_id == user.id)
    if user.department_id is not None:
        ids = ids.union(select(literal(int(user.department_id))))
    permitted = select(GuideRevisionDepartment.revision_id).where(
        GuideRevisionDepartment.department_id.in_(ids))
    return query.filter(or_(
        revision.audience == "all",
        and_(revision.audience == "departments", revision.id.in_(permitted)),
    ))


def can_view_revision(db: Session, user: models.User, document_id: int) -> bool:
    if not user.is_active:
        return False
    return visible_guide_query(db, user).filter(GuideDocument.id == document_id).first() is not None


def eligible_users(db: Session, revision: GuideRevision, departments: list[int]) -> list[models.User]:
    people = db.query(models.User).filter(models.User.is_active.is_(True)).all()
    if revision.audience == "all":
        return people
    if revision.audience == "management":
        return [user for user in people if str(user.role or "").lower() in MANAGEMENT]
    department_set = set(departments)
    members = (db.query(models.UserDepartment.user_id, models.UserDepartment.department_id)
        .filter(models.UserDepartment.department_id.in_(department_set)).all())
    extra = {uid for uid, did in members}
    return [user for user in people if (
        str(user.role or "").lower() in PUBLISHERS
        or user.department_id in department_set
        or user.id in extra
    )]
