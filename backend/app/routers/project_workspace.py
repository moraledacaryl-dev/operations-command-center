from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models as m
from ..authorization_policy import Action, authorize_action, scope_query, department_ids_for
from ..clock import utc_now
from ..database import get_db
from ..services.notifications import notify_user
from ..utils import log_activity, model_to_dict
from .api import require_user

router = APIRouter(prefix='/api/project-workspaces', tags=['Project workspace'])
Money = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)]
Category = Literal['Decorations', 'Food & drinks', 'Activities', 'Equipment', 'Marketing', 'Other']
Status = Literal['Suggested', 'Planned', 'Purchased', 'Declined']


class Payload(BaseModel):
    model_config = ConfigDict(extra='forbid')


class DiscussionPayload(Payload):
    body: Body
    comment_type: Literal['Suggestion', 'Update', 'Question', 'Decision'] = 'Suggestion'
    reply_to_id: int | None = Field(default=None, gt=0)


class VotePayload(Payload):
    voted: bool


class BudgetPayload(Payload):
    limit_cents: Money | None
    version: int = Field(ge=0)


class PurchasePayload(Payload):
    name: Name
    quantity: int = Field(default=1, strict=True, ge=1, le=10000)
    unit_price_cents: Money | None = None
    category: Category = 'Other'
    note: str | None = Field(default=None, max_length=4000)
    source_comment_id: int | None = Field(default=None, gt=0)


class PurchaseEdit(Payload):
    name: Name
    quantity: int = Field(strict=True, ge=1, le=10000)
    unit_price_cents: Money | None
    category: Category
    note: str | None = Field(default=None, max_length=4000)
    actual_total_cents: Money | None = None
    version: int = Field(ge=1)


class PurchaseTransition(Payload):
    status: Status
    actual_total_cents: Money | None = None
    version: int = Field(ge=1)


def project_for(db, user, project_id, action=Action.VIEW):
    project = db.get(m.Project, project_id)
    if not project:
        raise HTTPException(404, 'Project not found.')
    authorize_action(db, user, 'projects', action, obj=project)
    if action != Action.VIEW and (project.hidden_from_active or project.status == 'Done'):
        raise HTTPException(409, 'Reopen the project before making changes.')
    return project


def can_act(db, user, project, action):
    if project.hidden_from_active or project.status == 'Done':
        return False
    try:
        authorize_action(db, user, 'projects', action, obj=project)
        return True
    except HTTPException:
        return False


def notify_project(db, project, actor, kind, title, body, *, recipient_ids=None, managers=False, anchor=''):
    for person in db.query(m.User).filter(m.User.is_active.is_(True)).all():
        if person.id == actor.id:
            continue
        if recipient_ids is not None:
            if person.id not in recipient_ids:
                continue
        elif not managers and person.id != project.owner_id and project.department_id not in department_ids_for(db, person):
            continue
        try:
            authorize_action(db, person, 'projects', Action.EDIT if managers else Action.VIEW, obj=project)
        except HTTPException:
            continue
        notify_user(db, person.id, kind, title, body, source_type='projects', source_id=project.id,
                    action_url=f'/projects/{project.id}{anchor}')


def comment_for(db, project_id, comment_id):
    row = db.get(m.Comment, comment_id)
    if not row or row.parent_type != 'projects' or row.parent_id != project_id:
        raise HTTPException(404, 'Discussion not found in this project.')
    return row


def purchase_for(db, project_id, item_id):
    item = db.get(m.ProjectPurchaseItem, item_id)
    if not item or item.project_id != project_id:
        raise HTTPException(404, 'Purchase item not found in this project.')
    return item


def commit(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'This record changed. Refresh and try again.')


def update_versioned(db, model, identity, version, values):
    count = db.query(model).filter(identity, model.version == version).update(
        {**values, 'version': version + 1, 'updated_at': utc_now()}, synchronize_session=False)
    if count != 1:
        db.rollback()
        raise HTTPException(409, 'This record changed. Refresh before saving again.')


def budget_totals(items, budget):
    suggested = planned = purchased = unpriced = 0
    for row in items:
        if row.status == 'Declined':
            continue
        if row.status == 'Purchased':
            purchased += row.actual_total_cents or 0
        elif row.unit_price_cents is None:
            unpriced += 1
        elif row.status == 'Planned':
            planned += row.quantity * row.unit_price_cents
        else:
            suggested += row.quantity * row.unit_price_cents
    committed = planned + purchased
    limit = budget.limit_cents if budget else None
    return dict(limit_cents=limit, version=budget.version if budget else 0,
                suggested_cents=suggested, planned_cents=planned, purchased_cents=purchased,
                committed_cents=committed, forecast_cents=committed + suggested,
                remaining_cents=None if limit is None else limit - committed,
                unpriced_count=unpriced)


@router.get('/{project_id}')
def workspace(project_id: int, user: m.User = Depends(require_user), db: Session = Depends(get_db)):
    project = project_for(db, user, project_id)
    comments = db.query(m.Comment).filter_by(parent_type='projects', parent_id=project_id).order_by(m.Comment.created_at, m.Comment.id).all()
    votes = db.query(m.ProjectCommentVote).join(m.Comment, m.Comment.id == m.ProjectCommentVote.comment_id).filter(m.Comment.parent_type == 'projects', m.Comment.parent_id == project_id).all()
    items = db.query(m.ProjectPurchaseItem).filter_by(project_id=project_id).order_by(m.ProjectPurchaseItem.created_at, m.ProjectPurchaseItem.id).all()
    person_ids = {c.author_id for c in comments} | {p.proposed_by_id for p in items}
    people = {p.id: p.name for p in db.query(m.User).filter(m.User.id.in_(person_ids)).all()} if person_ids else {}
    votes_by_comment = {}
    for vote in votes:
        votes_by_comment.setdefault(vote.comment_id, set()).add(vote.user_id)
    comment_data = [{**model_to_dict(c), 'author_name': people.get(c.author_id, 'Team member'),
                     'vote_count': len(votes_by_comment.get(c.id, set())),
                     'voted': user.id in votes_by_comment.get(c.id, set())} for c in comments]
    can_manage = can_act(db, user, project, Action.EDIT)
    can_contribute = can_act(db, user, project, Action.COMMENT)
    return {
        'project': model_to_dict(project), 'can_manage': can_manage, 'can_contribute': can_contribute,
        'comments': comment_data,
        'purchases': [{**model_to_dict(p), 'proposed_by_name': people.get(p.proposed_by_id, 'Team member'),
                       'estimate_cents': None if p.unit_price_cents is None else p.quantity * p.unit_price_cents,
                       'can_edit': can_contribute and (can_manage or (p.proposed_by_id == user.id and p.status == 'Suggested'))} for p in items],
        'budget': budget_totals(items, db.get(m.ProjectBudget, project_id)),
        'tasks': [model_to_dict(t) for t in scope_query(db, user, m.Task, db.query(m.Task)).filter_by(project_id=project_id).order_by(m.Task.id).all()],
    }


@router.post('/{project_id}/discussion', status_code=201)
def discuss(project_id: int, payload: DiscussionPayload, user: m.User = Depends(require_user), db: Session = Depends(get_db)):
    project = project_for(db, user, project_id, Action.COMMENT)
    if payload.comment_type == 'Decision' and not can_act(db, user, project, Action.EDIT):
        raise HTTPException(403, 'Only project managers can post decisions.')
    if payload.reply_to_id:
        parent = comment_for(db, project_id, payload.reply_to_id)
        if parent.reply_to_id:
            raise HTTPException(422, 'Reply to the main discussion thread.')
    comment = m.Comment(parent_type='projects', parent_id=project_id, author_id=user.id, **payload.model_dump())
    db.add(comment)
    db.flush()
    recipients = None
    if payload.reply_to_id:
        recipients = {parent.author_id, project.owner_id} | {row.author_id for row in db.query(m.Comment).filter_by(parent_type='projects', parent_id=project_id, reply_to_id=parent.id).all()}
    notify_project(db, project, user, 'Discussion',
                   f'{user.name} replied in {project.title}' if payload.reply_to_id else f'{user.name} started a discussion in {project.title}',
                   payload.body[:500], recipient_ids=recipients,
                   anchor=f'?discussion={payload.reply_to_id or comment.id}')
    log_activity(db, 'projects', project_id, 'discussion', payload.body[:120], actor_id=user.id)
    commit(db)
    db.refresh(comment)
    return model_to_dict(comment)


@router.post('/{project_id}/discussion/{comment_id}/vote')
def vote(project_id: int, comment_id: int, payload: VotePayload, user: m.User = Depends(require_user), db: Session = Depends(get_db)):
    project_for(db, user, project_id, Action.COMMENT)
    comment = comment_for(db, project_id, comment_id)
    if comment.reply_to_id:
        raise HTTPException(422, 'Vote on the main discussion thread.')
    row = db.query(m.ProjectCommentVote).filter_by(comment_id=comment_id, user_id=user.id).first()
    if payload.voted and not row:
        db.add(m.ProjectCommentVote(comment_id=comment_id, user_id=user.id))
    elif not payload.voted and row:
        db.delete(row)
    commit(db)
    return {'voted': payload.voted}


@router.put('/{project_id}/budget')
def set_budget(project_id: int, payload: BudgetPayload, user: m.User = Depends(require_user), db: Session = Depends(get_db)):
    project_for(db, user, project_id, Action.EDIT)
    budget = db.get(m.ProjectBudget, project_id)
    previous_limit_cents = budget.limit_cents if budget else None
    previous_version = budget.version if budget else 0
    if not budget:
        if payload.version != 0:
            raise HTTPException(409, 'Refresh the project budget.')
        db.add(m.ProjectBudget(project_id=project_id, limit_cents=payload.limit_cents, updated_by_id=user.id, version=1))
    else:
        update_versioned(db, m.ProjectBudget, m.ProjectBudget.project_id == project_id, payload.version,
                         {'limit_cents': payload.limit_cents, 'updated_by_id': user.id})
    log_activity(db, 'projects', project_id, 'budget', 'Project budget updated', actor_id=user.id, metadata={'previous_limit_cents': previous_limit_cents, 'new_limit_cents': payload.limit_cents, 'previous_version': previous_version})
    commit(db)
    return {'saved': True}


@router.post('/{project_id}/purchases', status_code=201)
def add_purchase(project_id: int, payload: PurchasePayload, user: m.User = Depends(require_user), db: Session = Depends(get_db)):
    project = project_for(db, user, project_id, Action.COMMENT)
    if payload.source_comment_id:
        comment_for(db, project_id, payload.source_comment_id)
    item = m.ProjectPurchaseItem(project_id=project_id, proposed_by_id=user.id, updated_by_id=user.id, status='Suggested', **payload.model_dump())
    db.add(item)
    db.flush()
    notify_project(db, project, user, 'Purchase suggestion', f'{user.name} suggested a purchase',
                   f'{project.title}: {item.name}', managers=True, anchor=f'?purchase={item.id}')
    log_activity(db, 'projects', project_id, 'purchase_suggested', payload.name, actor_id=user.id, metadata={'purchase_id': item.id, 'quantity': item.quantity, 'unit_price_cents': item.unit_price_cents, 'status': item.status})
    commit(db)
    db.refresh(item)
    return model_to_dict(item)


@router.patch('/{project_id}/purchases/{item_id}')
def edit_purchase(project_id: int, item_id: int, payload: PurchaseEdit, user: m.User = Depends(require_user), db: Session = Depends(get_db)):
    project = project_for(db, user, project_id, Action.COMMENT)
    item = purchase_for(db, project_id, item_id)
    manager = can_act(db, user, project, Action.EDIT)
    if not manager and (item.proposed_by_id != user.id or item.status != 'Suggested'):
        raise HTTPException(403, 'You can edit only your own suggested items.')
    if payload.actual_total_cents is not None and item.status != 'Purchased':
        raise HTTPException(422, 'Record actual cost when marking the item purchased.')
    if item.status == 'Purchased' and payload.actual_total_cents is None:
        raise HTTPException(422, 'Enter the actual total paid.')
    previous = {key: getattr(item, key) for key in payload.model_fields if key != 'version'}
    values = payload.model_dump(exclude={'version'})
    update_versioned(db, m.ProjectPurchaseItem, m.ProjectPurchaseItem.id == item_id, payload.version,
                     {**values, 'updated_by_id': user.id})
    log_activity(db, 'projects', project_id, 'purchase_edited', payload.name, actor_id=user.id, metadata={'purchase_id': item_id, 'before': previous, 'after': values, 'previous_version': payload.version})
    commit(db)
    return {'saved': True}


TRANSITIONS = {'Suggested': {'Planned', 'Declined'}, 'Planned': {'Purchased', 'Suggested', 'Declined'},
               'Purchased': {'Planned'}, 'Declined': {'Suggested'}}


@router.post('/{project_id}/purchases/{item_id}/status')
def purchase_status(project_id: int, item_id: int, payload: PurchaseTransition, user: m.User = Depends(require_user), db: Session = Depends(get_db)):
    project = project_for(db, user, project_id, Action.EDIT)
    item = purchase_for(db, project_id, item_id)
    if payload.status not in TRANSITIONS[item.status]:
        raise HTTPException(409, 'This status change is not available. Refresh the list.')
    if payload.status == 'Purchased' and payload.actual_total_cents is None:
        raise HTTPException(422, 'Enter the actual total paid.')
    if payload.status != 'Purchased' and payload.actual_total_cents is not None:
        raise HTTPException(422, 'Actual cost applies only to purchased items.')
    previous_status = item.status
    previous_actual_total_cents = item.actual_total_cents
    update_versioned(db, m.ProjectPurchaseItem, m.ProjectPurchaseItem.id == item_id, payload.version,
                     {'status': payload.status, 'actual_total_cents': payload.actual_total_cents, 'updated_by_id': user.id})
    notify_project(db, project, user, 'Purchase update', f'{item.name}: {payload.status}', project.title,
                   recipient_ids={item.proposed_by_id}, anchor=f'?purchase={item.id}')
    log_activity(db, 'projects', project_id, 'purchase_status', f'{item.name}: {payload.status}', actor_id=user.id, metadata={'purchase_id': item_id, 'previous_status': previous_status, 'new_status': payload.status, 'previous_actual_total_cents': previous_actual_total_cents, 'new_actual_total_cents': payload.actual_total_cents, 'previous_version': payload.version})
    commit(db)
    return {'saved': True}
