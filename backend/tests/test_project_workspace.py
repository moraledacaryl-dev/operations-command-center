import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models as m
from app.routers import project_workspace as w


@pytest.fixture()
def ctx():
    engine = create_engine('sqlite:///:memory:')
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    a, b = m.Department(name='Events'), m.Department(name='Other')
    db.add_all([a, b]); db.flush()
    owner = m.User(name='Owner', role='owner', is_active=True)
    staff = m.User(name='Staff', role='staff', department_id=a.id, is_active=True)
    peer = m.User(name='Peer', role='staff', department_id=a.id, is_active=True)
    outsider = m.User(name='Other staff', role='staff', department_id=b.id, is_active=True)
    p = m.Project(title='Halloween', department_id=a.id, status='Active')
    other = m.Project(title='Other event', department_id=b.id, status='Active')
    db.add_all([owner, staff, peer, outsider, p, other]); db.commit()
    yield db, owner, staff, peer, outsider, p, other
    db.close(); engine.dispose()


def forbidden(call, code=403):
    with pytest.raises(HTTPException) as exc:
        call()
    assert exc.value.status_code == code


def test_threads_votes_and_existing_comments(ctx):
    db, owner, staff, peer, _, p, _ = ctx
    legacy = m.Comment(parent_type='projects', parent_id=p.id, author_id=owner.id, body='Existing update')
    db.add(legacy); db.commit()
    post = w.discuss(p.id, w.DiscussionPayload(body='  Pumpkin decorating?  '), staff, db)
    assert post['body'] == 'Pumpkin decorating?'
    assert post['author_id'] == staff.id
    reply = w.discuss(p.id, w.DiscussionPayload(body='Yes, in the garden.', reply_to_id=post['id']), peer, db)
    forbidden(lambda: w.discuss(p.id, w.DiscussionPayload(body='Nested', reply_to_id=reply['id']), peer, db), 422)
    for _ in range(2):
        w.vote(p.id, post['id'], w.VotePayload(voted=True), peer, db)
    snapshot = w.workspace(p.id, peer, db)
    assert len(snapshot['comments']) == 3
    assert next(c for c in snapshot['comments'] if c['id'] == post['id'])['vote_count'] == 1
    w.vote(p.id, post['id'], w.VotePayload(voted=False), peer, db)
    assert db.query(m.ProjectCommentVote).count() == 0
    forbidden(lambda: w.discuss(p.id, w.DiscussionPayload(body='Approved', comment_type='Decision'), staff, db))


def test_project_scope_and_cross_project_references(ctx):
    db, owner, staff, _, outsider, p, other = ctx
    forbidden(lambda: w.workspace(p.id, outsider, db))
    forbidden(lambda: w.discuss(p.id, w.DiscussionPayload(body='No access'), outsider, db))
    post = w.discuss(other.id, w.DiscussionPayload(body='Elsewhere'), owner, db)
    forbidden(lambda: w.discuss(p.id, w.DiscussionPayload(body='Reply', reply_to_id=post['id']), staff, db), 404)
    forbidden(lambda: w.add_purchase(p.id, w.PurchasePayload(name='Balloons', source_comment_id=post['id']), staff, db), 404)
    forbidden(lambda: w.vote(p.id, post['id'], w.VotePayload(voted=True), staff, db), 404)
    item = w.add_purchase(other.id, w.PurchasePayload(name='Other item'), owner, db)
    forbidden(lambda: w.purchase_status(p.id, item['id'], w.PurchaseTransition(status='Planned', version=1), owner, db), 404)


def test_budget_estimates_actuals_unpriced_and_declined(ctx):
    db, owner, staff, _, _, p, _ = ctx
    w.set_budget(p.id, w.BudgetPayload(limit_cents=10000, version=0), owner, db)
    a = w.add_purchase(p.id, w.PurchasePayload(name='Pumpkins', quantity=3, unit_price_cents=1999), staff, db)
    b = w.add_purchase(p.id, w.PurchasePayload(name='Candy', quantity=2, unit_price_cents=3000), staff, db)
    w.add_purchase(p.id, w.PurchasePayload(name='Speaker rental'), staff, db)
    w.add_purchase(p.id, w.PurchasePayload(name='Borrowed table', unit_price_cents=0), staff, db)
    before = w.workspace(p.id, owner, db)['budget']
    assert before['suggested_cents'] == 11997
    assert before['unpriced_count'] == 1  # zero is priced, null is unknown
    w.purchase_status(p.id, a['id'], w.PurchaseTransition(status='Planned', version=1), owner, db)
    w.purchase_status(p.id, b['id'], w.PurchaseTransition(status='Declined', version=1), owner, db)
    budget = w.workspace(p.id, owner, db)['budget']
    assert budget['planned_cents'] == 5997
    assert budget['remaining_cents'] == 4003
    assert budget['forecast_cents'] == 5997
    forbidden(lambda: w.purchase_status(p.id, a['id'], w.PurchaseTransition(status='Purchased', version=2), owner, db), 422)
    w.purchase_status(p.id, a['id'], w.PurchaseTransition(status='Purchased', version=2, actual_total_cents=11000), owner, db)
    budget = w.workspace(p.id, owner, db)['budget']
    assert budget['planned_cents'] == 0
    assert budget['purchased_cents'] == 11000
    assert budget['remaining_cents'] == -1000
    assert budget['forecast_cents'] == 11000
    w.purchase_status(p.id, a['id'], w.PurchaseTransition(status='Planned', version=3), owner, db)
    assert w.workspace(p.id, owner, db)['budget']['purchased_cents'] == 0


def test_staff_suggests_but_cannot_plan_or_set_budget(ctx):
    db, owner, staff, peer, _, p, _ = ctx
    item = w.add_purchase(p.id, w.PurchasePayload(name='Candy', unit_price_cents=500), staff, db)
    edit = w.PurchaseEdit(name='Candy packs', quantity=3, unit_price_cents=550, category='Food & drinks', version=1)
    forbidden(lambda: w.edit_purchase(p.id, item['id'], edit, peer, db))
    w.edit_purchase(p.id, item['id'], edit, staff, db)
    forbidden(lambda: w.set_budget(p.id, w.BudgetPayload(limit_cents=10000, version=0), staff, db))
    forbidden(lambda: w.purchase_status(p.id, item['id'], w.PurchaseTransition(status='Planned', version=2), staff, db))
    w.purchase_status(p.id, item['id'], w.PurchaseTransition(status='Planned', version=2), owner, db)
    forbidden(lambda: w.edit_purchase(p.id, item['id'], edit.model_copy(update={'version':3}), staff, db))
    assert w.workspace(p.id, staff, db)['purchases'][0]['can_edit'] is False


def test_stale_edits_do_not_overwrite_and_closed_projects_are_read_only(ctx):
    db, owner, staff, _, _, p, _ = ctx
    w.set_budget(p.id, w.BudgetPayload(limit_cents=20000, version=0), owner, db)
    forbidden(lambda: w.set_budget(p.id, w.BudgetPayload(limit_cents=30000, version=0), owner, db), 409)
    assert w.workspace(p.id, owner, db)['budget']['limit_cents'] == 20000
    item = w.add_purchase(p.id, w.PurchasePayload(name='Candy'), staff, db)
    edit = w.PurchaseEdit(name='Candy packs', quantity=2, unit_price_cents=100, category='Other', version=1)
    w.edit_purchase(p.id, item['id'], edit, staff, db)
    forbidden(lambda: w.edit_purchase(p.id, item['id'], edit, staff, db), 409)
    p.status = 'Done'; db.commit()
    assert w.workspace(p.id, owner, db)['can_contribute'] is False
    forbidden(lambda: w.discuss(p.id, w.DiscussionPayload(body='Too late'), staff, db), 409)
    forbidden(lambda: w.add_purchase(p.id, w.PurchasePayload(name='More'), owner, db), 409)


@pytest.mark.parametrize('payload', [dict(name=' '), dict(name='Item', quantity=0), dict(name='Item', quantity=1.5), dict(name='Item', unit_price_cents=-1), dict(name='Item', unit_price_cents=1.5), dict(name='Item', status='Purchased'), dict(name='Item', proposed_by_id=42)])
def test_invalid_purchase_input(payload):
    with pytest.raises(ValidationError):
        w.PurchasePayload(**payload)


def test_discussion_notifications_follow_scope_and_thread_participants(ctx):
    from app.foundation_models import Notification
    db, owner, staff, peer, outsider, p, _ = ctx
    p.owner_id = owner.id
    inactive = m.User(name='Inactive', role='staff', department_id=p.department_id, is_active=False)
    db.add(inactive); db.commit()
    post = w.discuss(p.id, w.DiscussionPayload(body='Decorations?'), staff, db)
    notices = db.query(Notification).all()
    assert {n.user_id for n in notices} == {peer.id, owner.id}
    assert all(n.action_url == f"/projects/{p.id}?discussion={post['id']}" for n in notices)
    db.query(Notification).delete(); db.commit()
    w.discuss(p.id, w.DiscussionPayload(body='Yes', reply_to_id=post['id']), peer, db)
    assert {n.user_id for n in db.query(Notification).all()} == {staff.id, owner.id}
    db.query(Notification).delete(); db.commit()
    peer.department_id = outsider.department_id; db.commit()
    w.discuss(p.id, w.DiscussionPayload(body='Thanks', reply_to_id=post['id']), owner, db)
    assert {n.user_id for n in db.query(Notification).all()} == {staff.id}


def test_purchase_notifications_and_failed_changes_are_atomic(ctx):
    from app.foundation_models import Notification
    db, owner, staff, peer, outsider, p, _ = ctx
    lead = m.User(name='Lead', role='lead', department_id=p.department_id, is_active=True)
    other_lead = m.User(name='Other lead', role='lead', department_id=outsider.department_id, is_active=True)
    db.add_all([lead, other_lead]); db.commit()
    item = w.add_purchase(p.id, w.PurchasePayload(name='Candy'), staff, db)
    assert {n.user_id for n in db.query(Notification).all()} == {owner.id, lead.id}
    assert all(n.action_url == f"/projects/{p.id}?purchase={item['id']}" for n in db.query(Notification).all())
    db.query(Notification).delete(); db.commit()
    w.purchase_status(p.id, item['id'], w.PurchaseTransition(status='Planned', version=1), owner, db)
    notice = db.query(Notification).one()
    assert notice.user_id == staff.id
    assert notice.title == 'Candy: Planned'
    forbidden(lambda: w.purchase_status(p.id, item['id'], w.PurchaseTransition(status='Declined', version=1), owner, db), 409)
    assert db.query(Notification).count() == 1


def test_financial_audit_records_before_and_after_values(ctx):
    import json

    db, owner, staff, _, _, project, _ = ctx
    w.set_budget(project.id, w.BudgetPayload(limit_cents=10000, version=0), owner, db)
    w.set_budget(project.id, w.BudgetPayload(limit_cents=15000, version=1), owner, db)
    item = w.add_purchase(project.id, w.PurchasePayload(name='Tables', quantity=2, unit_price_cents=2000), staff, db)
    w.edit_purchase(project.id, item['id'], w.PurchaseEdit(
        name='Tables and chairs', quantity=3, unit_price_cents=2200,
        category='Equipment', version=1), staff, db)
    w.purchase_status(project.id, item['id'], w.PurchaseTransition(status='Planned', version=2), owner, db)
    w.purchase_status(project.id, item['id'], w.PurchaseTransition(
        status='Purchased', actual_total_cents=6700, version=3), owner, db)

    entries = db.query(m.ActivityLog).filter_by(entity_type='projects', entity_id=project.id).all()
    budgets = [json.loads(e.metadata_json) for e in entries if e.action == 'budget']
    assert budgets[0]['previous_limit_cents'] is None
    assert budgets[0]['new_limit_cents'] == 10000
    assert budgets[1]['previous_limit_cents'] == 10000
    assert budgets[1]['new_limit_cents'] == 15000
    assert budgets[1]['previous_version'] == 1

    suggested = next(json.loads(e.metadata_json) for e in entries if e.action == 'purchase_suggested')
    assert suggested['purchase_id'] == item['id']
    assert suggested['quantity'] == 2
    assert suggested['unit_price_cents'] == 2000

    edited = next(json.loads(e.metadata_json) for e in entries if e.action == 'purchase_edited')
    assert edited['before']['name'] == 'Tables'
    assert edited['before']['quantity'] == 2
    assert edited['after']['name'] == 'Tables and chairs'
    assert edited['after']['quantity'] == 3

    transitions = [json.loads(e.metadata_json) for e in entries if e.action == 'purchase_status']
    assert transitions[0]['previous_status'] == 'Suggested'
    assert transitions[0]['new_status'] == 'Planned'
    assert transitions[1]['previous_status'] == 'Planned'
    assert transitions[1]['new_status'] == 'Purchased'
    assert transitions[1]['new_actual_total_cents'] == 6700
    assert all(e.actor_id is not None for e in entries if e.action in {
        'budget', 'purchase_suggested', 'purchase_edited', 'purchase_status'
    })


def test_failed_purchase_update_does_not_write_audit_entry(ctx):
    db, owner, staff, _, _, project, _ = ctx
    item = w.add_purchase(project.id, w.PurchasePayload(name='Decor'), staff, db)
    w.purchase_status(project.id, item['id'], w.PurchaseTransition(status='Planned', version=1), owner, db)
    before = db.query(m.ActivityLog).count()
    forbidden(lambda: w.purchase_status(
        project.id, item['id'], w.PurchaseTransition(status='Declined', version=1), owner, db), 409)
    assert db.query(m.ActivityLog).count() == before


def test_purchased_item_financial_edits_require_manager(ctx):
    db, owner, staff, _, _, project, _ = ctx
    item = w.add_purchase(project.id, w.PurchasePayload(name='Equipment', unit_price_cents=2000), staff, db)
    w.purchase_status(project.id, item['id'], w.PurchaseTransition(status='Planned', version=1), owner, db)
    w.purchase_status(project.id, item['id'], w.PurchaseTransition(
        status='Purchased', actual_total_cents=2100, version=2), owner, db)
    payload = w.PurchaseEdit(name='Equipment', quantity=1, unit_price_cents=2000,
                             actual_total_cents=2200, category='Other', version=3)
    forbidden(lambda: w.edit_purchase(project.id, item['id'], payload, staff, db))
    assert db.get(m.ProjectPurchaseItem, item['id']).actual_total_cents == 2100
    w.edit_purchase(project.id, item['id'], payload, owner, db)
    assert db.get(m.ProjectPurchaseItem, item['id']).actual_total_cents == 2200
