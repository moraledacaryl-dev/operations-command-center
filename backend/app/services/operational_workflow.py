from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..authorization_policy import Action, authorize_action
from ..clock import utc_now
from ..utils import log_activity, mark_completed_if_needed


@dataclass(frozen=True)
class Transition:
    source: str
    target: str
    note_required: bool = False


TRANSITIONS: dict[str, dict[str, Transition]] = {
    "tasks": {
        "start": Transition("To Do", "Doing"),
        "submit-review": Transition("Doing", "Review"),
        "request-changes": Transition("Review", "Doing", True),
        "complete": Transition("Review", "Done"),
        "reopen": Transition("Done", "Doing", True),
    },
    "projects": {
        "start": Transition("Planned", "Active"),
        "pause": Transition("Active", "Paused", True),
        "resume": Transition("Paused", "Active"),
        "complete": Transition("Active", "Done"),
        "reopen": Transition("Done", "Active", True),
    },
    "posts": {
        "start-draft": Transition("Idea", "Draft"),
        "submit-review": Transition("Draft", "Review"),
        "resubmit-review": Transition("Fix", "Review"),
        "request-revision": Transition("Review", "Fix", True),
        "approve": Transition("Review", "OK"),
        "schedule": Transition("OK", "Set"),
        "publish": Transition("Set", "Posted"),
        "return-draft-from-fix": Transition("Fix", "Draft", True),
        "return-draft-from-ok": Transition("OK", "Draft", True),
        "return-draft-from-set": Transition("Set", "Draft", True),
        "reopen": Transition("Posted", "Draft", True),
    },
    "guests": {
        "follow-up": Transition("Open", "Follow"),
        "resolve-open": Transition("Open", "Done"),
        "resolve-follow": Transition("Follow", "Done"),
        "reopen": Transition("Done", "Follow", True),
    },
    "shift-notes": {
        "acknowledge": Transition("New", "Seen"),
        "follow-up-new": Transition("New", "Follow"),
        "follow-up-seen": Transition("Seen", "Follow"),
        "resolve-new": Transition("New", "Done"),
        "resolve-seen": Transition("Seen", "Done"),
        "resolve-follow": Transition("Follow", "Done"),
        "reopen": Transition("Done", "Follow", True),
    },
}


RESOURCE_MODELS = {
    "tasks": models.Task,
    "projects": models.Project,
    "posts": models.Post,
    "guests": models.GuestNote,
    "shift-notes": models.ShiftNote,
}


def allowed_actions_for(db: Session, user: models.User, resource: str, obj) -> list[str]:
    transitions = TRANSITIONS.get(resource)
    if not transitions or obj is None:
        return []
    try:
        authorize_action(db, user, resource, Action.TRANSITION, obj=obj)
    except HTTPException:
        return []
    current = str(getattr(obj, "status", ""))
    return [action for action, transition in transitions.items() if transition.source == current]


def transition_operational(
    db: Session,
    user: models.User,
    resource: str,
    item_id: int,
    action: str,
    note: str | None = None,
):
    model = RESOURCE_MODELS.get(resource)
    transition = TRANSITIONS.get(resource, {}).get(action)
    if model is None or transition is None:
        raise HTTPException(status_code=404, detail="Unknown workflow action")

    obj = db.query(model).filter(model.id == item_id).with_for_update().one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Record not found")
    authorize_action(db, user, resource, Action.TRANSITION, obj=obj)

    if obj.status != transition.source:
        raise HTTPException(
            status_code=409,
            detail=f"{action.replace('-', ' ').title()} requires {transition.source}; current state is {obj.status}.",
        )
    clean_note = (note or "").strip()
    if transition.note_required and not clean_note:
        raise HTTPException(status_code=400, detail="A reason is required for this action.")

    obj.status = transition.target
    mark_completed_if_needed(obj, transition.target)
    now = utc_now()
    if resource == "projects":
        if action == "start" and not obj.start_date:
            obj.start_date = now
    elif resource == "shift-notes" and action == "acknowledge":
        obj.seen_by_id = user.id
        obj.seen_at = now
    elif resource == "guests" and transition.target == "Done" and clean_note:
        obj.action_taken = clean_note

    if clean_note:
        obj.note = f"{obj.note or ''}\n\n{action.replace('-', ' ').title()}: {clean_note}".strip()
    log_activity(
        db,
        resource,
        obj.id,
        action,
        f"{transition.source} → {transition.target}",
        actor_id=user.id,
        metadata={"note": clean_note or None},
    )
    db.commit()
    db.refresh(obj)
    return obj


__all__ = ["TRANSITIONS", "allowed_actions_for", "transition_operational"]
