from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import foundation_models as foundation
from .. import models
from ..authorization_policy import Action, department_ids_for
from ..capabilities import has_capability
from ..clock import utc_now
from ..database import get_db
from ..domain_values import ContentFormat, Platform
from ..pagination import cursor_page, decode_cursor, encode_cursor
from ..services.marketing_workflow import allowed_deliverable_actions, authorize_campaign, campaign_or_404, transition_deliverable
from ..utils import log_activity, model_to_dict
from .api import require_user


router = APIRouter(prefix="/api/marketing", tags=["marketing"])


class CampaignCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    department_id: int
    name: str = Field(min_length=1, max_length=180)
    objective: str | None = None
    owner_id: int | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    budget_note: str | None = None


class PlatformDeliverableCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    platform: Platform
    format: ContentFormat
    scheduled_at: datetime | None = None
    caption: str | None = None
    call_to_action: str | None = None
    hashtags: str | None = None
    assigned_to_id: int | None = None


class ConceptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    campaign_id: int
    title: str = Field(min_length=1, max_length=180)
    content_pillar: str = Field(default="General", min_length=1, max_length=80)
    brief: str | None = None
    owner_id: int | None = None
    platforms: list[Platform] = Field(min_length=1, max_length=6)
    format: ContentFormat
    scheduled_at: datetime | None = None
    shared_caption: str | None = None
    deliverables: list[PlatformDeliverableCreate] | None = Field(default=None, max_length=6)


class DeliverableCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: str | None = None
    final_url: str | None = None


class RescheduleCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scheduled_at: datetime | None


def _campaign_payload(campaign: foundation.MarketingCampaign) -> dict:
    return model_to_dict(campaign)


def _deliverable_payload(db: Session, user: models.User, deliverable: foundation.PlatformDeliverable) -> dict:
    data = model_to_dict(deliverable)
    data["allowed_actions"] = allowed_deliverable_actions(db, user, deliverable)
    return data


@router.get("/campaigns")
def campaigns(
    paginated: bool = Query(default=False),
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    cursor: str | None = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    query = db.query(foundation.MarketingCampaign)
    if not has_capability(user.role, "view_all_operations"):
        query = query.filter(foundation.MarketingCampaign.department_id.in_(department_ids_for(db, user)))
    if paginated:
        return cursor_page(query, foundation.MarketingCampaign, "marketing-campaigns", limit, cursor)
    return [_campaign_payload(row) for row in query.order_by(foundation.MarketingCampaign.updated_at.desc()).all()]


@router.post("/campaigns")
def create_campaign(payload: CampaignCreate, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    authorize_campaign(db, user, foundation.MarketingCampaign(department_id=payload.department_id), Action.CREATE)
    if payload.end_at and payload.start_at and payload.end_at < payload.start_at:
        raise HTTPException(status_code=422, detail="Campaign end must be after its start.")
    campaign = foundation.MarketingCampaign(**payload.model_dump())
    db.add(campaign)
    db.flush()
    log_activity(db, "marketing-campaigns", campaign.id, "created", "Campaign created", actor_id=user.id)
    db.commit()
    db.refresh(campaign)
    return _campaign_payload(campaign)


@router.get("/concepts")
def concepts(
    campaign_id: int | None = None,
    paginated: bool = Query(default=False),
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    cursor: str | None = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    query = db.query(foundation.ContentConcept).join(foundation.MarketingCampaign, foundation.MarketingCampaign.id == foundation.ContentConcept.campaign_id)
    if campaign_id:
        query = query.filter(foundation.ContentConcept.campaign_id == campaign_id)
    if not has_capability(user.role, "view_all_operations"):
        query = query.filter(foundation.MarketingCampaign.department_id.in_(department_ids_for(db, user)))
    if paginated:
        page = cursor_page(query, foundation.ContentConcept, "marketing-concepts", limit, cursor)
        rows = [db.get(foundation.ContentConcept, item["id"]) for item in page["items"]]
    else:
        rows = query.order_by(foundation.ContentConcept.updated_at.desc()).all()
    result = []
    for concept in rows:
        data = model_to_dict(concept)
        data["campaign"] = _campaign_payload(db.get(foundation.MarketingCampaign, concept.campaign_id))
        data["deliverables"] = [_deliverable_payload(db, user, row) for row in db.query(foundation.PlatformDeliverable).filter(foundation.PlatformDeliverable.concept_id == concept.id).order_by(foundation.PlatformDeliverable.platform).all()]
        result.append(data)
    if paginated:
        page["items"] = result
        return page
    return result


@router.post("/concepts")
def create_concept(payload: ConceptCreate, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    campaign = campaign_or_404(db, payload.campaign_id)
    authorize_campaign(db, user, campaign, Action.CREATE)
    platforms = list(dict.fromkeys(platform.value for platform in payload.platforms))
    if len(platforms) != len(payload.platforms):
        raise HTTPException(status_code=422, detail="Choose each platform only once.")
    concept = foundation.ContentConcept(
        campaign_id=campaign.id,
        title=payload.title.strip(),
        content_pillar=payload.content_pillar.strip(),
        brief=payload.brief,
        owner_id=payload.owner_id or user.id,
        status="Idea",
    )
    db.add(concept)
    db.flush()
    overrides = {item.platform.value: item for item in (payload.deliverables or [])}
    if set(overrides) - set(platforms):
        raise HTTPException(status_code=422, detail="Deliverable overrides must match the selected platforms.")
    for platform in platforms:
        override = overrides.get(platform)
        db.add(foundation.PlatformDeliverable(
            concept_id=concept.id,
            platform=platform,
            format=override.format.value if override else payload.format.value,
            caption=override.caption if override and override.caption is not None else payload.shared_caption,
            call_to_action=override.call_to_action if override else None,
            hashtags=override.hashtags if override else None,
            assigned_to_id=override.assigned_to_id if override and override.assigned_to_id else payload.owner_id or user.id,
            scheduled_at=override.scheduled_at if override else payload.scheduled_at,
            status="Planned",
        ))
    log_activity(db, "content-concepts", concept.id, "created", f"Created {len(platforms)} platform deliverables", actor_id=user.id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This concept already contains one of the selected platforms.") from exc
    db.refresh(concept)
    return {"concept": model_to_dict(concept), "deliverables": [_deliverable_payload(db, user, row) for row in db.query(foundation.PlatformDeliverable).filter(foundation.PlatformDeliverable.concept_id == concept.id).all()]}


@router.post("/deliverables/{deliverable_id}/transition/{action}")
def deliverable_action(deliverable_id: int, action: str, payload: DeliverableCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    row = transition_deliverable(db, user, deliverable_id, action, payload.note, payload.final_url)
    return _deliverable_payload(db, user, row)


@router.post("/deliverables/{deliverable_id}/reschedule")
def reschedule_deliverable(deliverable_id: int, payload: RescheduleCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    row = db.query(foundation.PlatformDeliverable).filter(foundation.PlatformDeliverable.id == deliverable_id).with_for_update().one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Platform deliverable not found")
    concept = db.get(foundation.ContentConcept, row.concept_id)
    campaign = campaign_or_404(db, concept.campaign_id) if concept else None
    authorize_campaign(db, user, campaign, Action.TRANSITION)
    if row.status == "Published":
        raise HTTPException(status_code=409, detail="Published deliverables cannot be rescheduled.")
    row.scheduled_at = payload.scheduled_at
    log_activity(db, "platform-deliverables", row.id, "rescheduled", "Publishing time updated", actor_id=user.id, metadata={"scheduled_at": payload.scheduled_at.isoformat() if payload.scheduled_at else None})
    db.commit()
    db.refresh(row)
    return _deliverable_payload(db, user, row)


@router.get("/calendar")
def marketing_calendar(
    date_from: datetime = Query(...),
    date_to: datetime = Query(...),
    department_id: int | None = Query(default=None),
    paginated: bool = Query(default=False),
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    cursor: str | None = Query(default=None),
    user: models.User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if date_to <= date_from or date_to - date_from > timedelta(days=93):
        raise HTTPException(status_code=422, detail="Calendar range must be between 1 and 93 days.")
    query = db.query(foundation.PlatformDeliverable, foundation.ContentConcept, foundation.MarketingCampaign).join(
        foundation.ContentConcept, foundation.ContentConcept.id == foundation.PlatformDeliverable.concept_id
    ).join(foundation.MarketingCampaign, foundation.MarketingCampaign.id == foundation.ContentConcept.campaign_id)
    if department_id:
        authorize_campaign(db, user, foundation.MarketingCampaign(department_id=department_id), Action.VIEW)
        query = query.filter(foundation.MarketingCampaign.department_id == department_id)
    elif not has_capability(user.role, "view_all_operations"):
        query = query.filter(foundation.MarketingCampaign.department_id.in_(department_ids_for(db, user)))
    query = query.filter(
        (foundation.PlatformDeliverable.scheduled_at.is_(None)) |
        ((foundation.PlatformDeliverable.scheduled_at >= date_from) & (foundation.PlatformDeliverable.scheduled_at < date_to))
    )
    if paginated and cursor:
        timestamp, item_id = decode_cursor("marketing-calendar", cursor)
        query = query.filter(or_(
            foundation.PlatformDeliverable.updated_at < timestamp,
            and_(foundation.PlatformDeliverable.updated_at == timestamp, foundation.PlatformDeliverable.id < item_id),
        ))
    ordered = query.order_by(foundation.PlatformDeliverable.updated_at.desc(), foundation.PlatformDeliverable.id.desc())
    rows = ordered.limit(limit + 1).all() if paginated else ordered.all()
    has_more = bool(paginated and len(rows) > limit)
    page_rows = rows[:limit] if paginated else rows
    items = [{
        **_deliverable_payload(db, user, deliverable),
        "concept_title": concept.title,
        "content_pillar": concept.content_pillar,
        "campaign_id": campaign.id,
        "campaign_name": campaign.name,
        "department_id": campaign.department_id,
    } for deliverable, concept, campaign in page_rows]
    if not paginated:
        return items
    last = page_rows[-1][0] if has_more and page_rows else None
    return {
        "items": items,
        "next_cursor": encode_cursor("marketing-calendar", last.updated_at, last.id) if last else None,
        "has_more": has_more,
    }
