from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import foundation_models as foundation
from app import model_constraints  # noqa: F401
from app import models
from app.clock import utc_now
from app.services.marketing_workflow import transition_deliverable


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    department = models.Department(name="Marketing")
    db.add(department)
    db.flush()
    owner = models.User(name="Owner", email="owner@example.com", role="owner", department_id=department.id, is_active=True)
    db.add(owner)
    db.flush()
    campaign = foundation.MarketingCampaign(department_id=department.id, name="Direct booking", owner_id=owner.id)
    db.add(campaign)
    db.flush()
    concept = foundation.ContentConcept(campaign_id=campaign.id, title="Sunset stay", content_pillar="Experience", owner_id=owner.id)
    db.add(concept)
    db.flush()
    deliverable = foundation.PlatformDeliverable(concept_id=concept.id, platform="Instagram", format="Reel", assigned_to_id=owner.id)
    db.add(deliverable)
    db.commit()
    try:
        yield db, owner, campaign, concept, deliverable
    finally:
        db.close()


def test_platform_deliverable_happy_path_and_required_publication_url(context):
    db, owner, _campaign, _concept, deliverable = context
    transition_deliverable(db, owner, deliverable.id, "start-draft")
    transition_deliverable(db, owner, deliverable.id, "submit-review")
    db.refresh(_concept)
    db.refresh(_campaign)
    assert _concept.status == "Active"
    assert _campaign.status == "Active"
    transition_deliverable(db, owner, deliverable.id, "approve")
    deliverable.scheduled_at = utc_now() + timedelta(days=1)
    db.commit()
    transition_deliverable(db, owner, deliverable.id, "schedule")
    with pytest.raises(HTTPException) as exc:
        transition_deliverable(db, owner, deliverable.id, "publish")
    assert exc.value.status_code == 400
    published = transition_deliverable(db, owner, deliverable.id, "publish", final_url="https://example.com/post")
    assert published.status == "Published"
    assert published.final_url == "https://example.com/post"
    db.refresh(_concept)
    db.refresh(_campaign)
    assert _concept.status == "Completed"
    assert _campaign.status == "Completed"


def test_revision_reason_and_source_state_are_enforced(context):
    db, owner, _campaign, _concept, deliverable = context
    with pytest.raises(HTTPException) as exc:
        transition_deliverable(db, owner, deliverable.id, "approve")
    assert exc.value.status_code == 409
    deliverable.status = "Review"
    db.commit()
    with pytest.raises(HTTPException) as exc:
        transition_deliverable(db, owner, deliverable.id, "request-revision")
    assert exc.value.status_code == 400
    revised = transition_deliverable(db, owner, deliverable.id, "request-revision", "Use the current room photos")
    assert revised.status == "Fix"


def test_one_platform_can_only_appear_once_per_concept(context):
    db, _owner, _campaign, concept, _deliverable = context
    db.add(foundation.PlatformDeliverable(concept_id=concept.id, platform="Instagram", format="Static"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_invalid_platform_is_rejected_by_database(context):
    db, _owner, _campaign, concept, _deliverable = context
    db.add(foundation.PlatformDeliverable(concept_id=concept.id, platform="Unsupported", format="Static"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
