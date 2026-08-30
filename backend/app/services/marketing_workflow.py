from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import foundation_models as foundation
from .. import models
from ..authorization_policy import Action, authorize_action
from ..clock import utc_now
from ..utils import log_activity


@dataclass(frozen=True)
class Transition:
    source: str
    target: str
    note_required: bool = False


DELIVERABLE_TRANSITIONS = {
    "start-draft": Transition("Planned", "Draft"),
    "submit-review": Transition("Draft", "Review"),
    "request-revision": Transition("Review", "Fix", True),
    "resubmit-review": Transition("Fix", "Review"),
    "approve": Transition("Review", "Approved"),
    "schedule": Transition("Approved", "Scheduled"),
    "publish": Transition("Scheduled", "Published"),
    "return-draft": Transition("Fix", "Draft", True),
    "reopen": Transition("Published", "Draft", True),
}


def campaign_or_404(db: Session, campaign_id: int) -> foundation.MarketingCampaign:
    campaign = db.get(foundation.MarketingCampaign, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Marketing campaign not found")
    return campaign


def authorize_campaign(db: Session, user: models.User, campaign: foundation.MarketingCampaign, action: Action = Action.VIEW) -> None:
    authorize_action(db, user, "posts", action, department_id=campaign.department_id)


def allowed_deliverable_actions(db: Session, user: models.User, deliverable: foundation.PlatformDeliverable) -> list[str]:
    concept = db.get(foundation.ContentConcept, deliverable.concept_id)
    campaign = campaign_or_404(db, concept.campaign_id) if concept else None
    if campaign is None:
        return []
    try:
        authorize_campaign(db, user, campaign, Action.TRANSITION)
    except HTTPException:
        return []
    return [name for name, transition in DELIVERABLE_TRANSITIONS.items() if transition.source == deliverable.status]


def _sync_parent_states(db: Session, concept: foundation.ContentConcept, campaign: foundation.MarketingCampaign) -> None:
    deliverable_statuses = [
        value for (value,) in db.query(foundation.PlatformDeliverable.status)
        .filter(foundation.PlatformDeliverable.concept_id == concept.id)
        .all()
    ]
    if deliverable_statuses and all(value == "Published" for value in deliverable_statuses):
        concept.status = "Completed"
    elif any(value != "Planned" for value in deliverable_statuses):
        concept.status = "Active"

    # Include the in-memory status because autoflush may be disabled by callers.
    concept_statuses = [
        concept.status if row.id == concept.id else row.status
        for row in db.query(foundation.ContentConcept)
        .filter(foundation.ContentConcept.campaign_id == campaign.id)
        .all()
    ]
    if concept_statuses and all(value == "Completed" for value in concept_statuses):
        campaign.status = "Completed"
    elif any(value in {"Active", "Completed"} for value in concept_statuses):
        campaign.status = "Active"


def transition_deliverable(db: Session, user: models.User, deliverable_id: int, action: str, note: str | None = None, final_url: str | None = None):
    transition = DELIVERABLE_TRANSITIONS.get(action)
    if transition is None:
        raise HTTPException(status_code=404, detail="Unknown marketing workflow action")
    deliverable = db.query(foundation.PlatformDeliverable).filter(foundation.PlatformDeliverable.id == deliverable_id).with_for_update().one_or_none()
    if deliverable is None:
        raise HTTPException(status_code=404, detail="Platform deliverable not found")
    concept = db.get(foundation.ContentConcept, deliverable.concept_id)
    campaign = campaign_or_404(db, concept.campaign_id) if concept else None
    authorize_campaign(db, user, campaign, Action.TRANSITION)
    if deliverable.status != transition.source:
        raise HTTPException(status_code=409, detail=f"{action.replace('-', ' ').title()} requires {transition.source}; current state is {deliverable.status}.")
    clean_note = (note or "").strip()
    if transition.note_required and not clean_note:
        raise HTTPException(status_code=400, detail="A reason is required for this action.")
    if action == "schedule" and deliverable.scheduled_at is None:
        raise HTTPException(status_code=400, detail="Set a publishing time before scheduling.")
    if action == "publish" and not (final_url or deliverable.final_url):
        raise HTTPException(status_code=400, detail="A final publication URL is required.")
    deliverable.status = transition.target
    if final_url:
        deliverable.final_url = final_url.strip()
    _sync_parent_states(db, concept, campaign)
    log_activity(db, "platform-deliverables", deliverable.id, action, f"{transition.source} → {transition.target}", actor_id=user.id, metadata={"note": clean_note or None, "at": utc_now().isoformat()})
    db.commit()
    db.refresh(deliverable)
    return deliverable


__all__ = ["allowed_deliverable_actions", "authorize_campaign", "campaign_or_404", "transition_deliverable"]
