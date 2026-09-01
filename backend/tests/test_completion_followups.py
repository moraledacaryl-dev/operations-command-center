from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import foundation_models as foundation
from app import models
from app.routers.authorized_crud import CommentPayload, add_comment_authorized, get_resource_authorized
from app.routers.marketing import ConceptCreate, PlatformDeliverableCreate, create_concept
from app.routers.privacy import AdminUserUpdatePayload, MembershipUpdatePayload, update_membership, update_user
from app.services.notifications import create_mentions


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def seed(db):
    marketing = models.Department(name="Marketing")
    operations = models.Department(name="Operations")
    db.add_all([marketing, operations])
    db.flush()
    owner = models.User(name="Owner", email="owner@example.com", role="owner", department_id=operations.id, is_active=True)
    teammate = models.User(name="Jamie Santos", email="jamie@example.com", role="staff", department_id=operations.id, is_active=True)
    db.add_all([owner, teammate])
    db.flush()
    membership = models.UserDepartment(user_id=teammate.id, department_id=operations.id, is_primary=True)
    db.add(membership)
    db.commit()
    return marketing, operations, owner, teammate, membership


def test_account_update_protects_last_owner_and_membership_can_change(db, monkeypatch):
    _marketing, operations, owner, teammate, membership = seed(db)
    monkeypatch.setattr("app.routers.privacy.revoke_user_sessions", lambda *_args: 1)
    with pytest.raises(HTTPException) as exc:
        update_user(owner.id, AdminUserUpdatePayload(role="admin"), actor=owner, db=db)
    assert exc.value.status_code == 409

    updated = update_user(teammate.id, AdminUserUpdatePayload(role="lead", is_active=False), actor=owner, db=db)
    assert updated.role == "lead"
    assert updated.is_active is False

    second = models.Department(name="Security")
    db.add(second)
    db.flush()
    extra = models.UserDepartment(user_id=teammate.id, department_id=second.id, is_primary=False)
    db.add(extra)
    db.commit()
    result = update_membership(extra.id, MembershipUpdatePayload(is_primary=True), actor=owner, db=db)
    assert result["is_primary"] is True
    db.refresh(membership)
    assert membership.is_primary is False


def test_mentions_create_notification_and_detail_uses_names(db):
    _marketing, operations, owner, teammate, _membership = seed(db)
    project = models.Project(title="Launch", department_id=operations.id, status="Planned")
    db.add(project)
    db.commit()
    add_comment_authorized("projects", project.id, CommentPayload(body="Please review @[Jamie Santos]", comment_type="Question"), user=owner, db=db)
    assert db.query(foundation.Mention).filter_by(mentioned_user_id=teammate.id).count() == 1
    assert db.query(foundation.Notification).filter_by(user_id=teammate.id).count() == 1
    detail = get_resource_authorized("projects", project.id, user=owner, db=db)
    assert detail["comments"][0]["author_name"] == "Owner"


def test_marketing_platform_overrides_are_transactional(db):
    marketing, _operations, owner, _teammate, _membership = seed(db)
    campaign = foundation.MarketingCampaign(department_id=marketing.id, name="September", owner_id=owner.id)
    db.add(campaign)
    db.commit()
    payload = ConceptCreate(
        campaign_id=campaign.id,
        title="Weekend escape",
        platforms=["Facebook", "Instagram"],
        format="Static",
        scheduled_at=datetime(2026, 9, 5, 1, tzinfo=timezone.utc),
        shared_caption="Shared",
        deliverables=[
            PlatformDeliverableCreate(platform="Instagram", format="Reel", caption="Instagram copy"),
        ],
    )
    result = create_concept(payload, user=owner, db=db)
    by_platform = {row["platform"]: row for row in result["deliverables"]}
    assert by_platform["Facebook"]["format"] == "Static"
    assert by_platform["Facebook"]["caption"] == "Shared"
    assert by_platform["Instagram"]["format"] == "Reel"
    assert by_platform["Instagram"]["caption"] == "Instagram copy"
