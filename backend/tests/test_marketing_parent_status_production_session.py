"""Marketing aggregate states must be correct with production autoflush=False sessions."""

from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
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
    # Match app.database.SessionLocal (production: autoflush=False).
    db = sessionmaker(bind=engine, autoflush=False)()
    department = models.Department(name="Marketing")
    db.add(department)
    db.flush()
    owner = models.User(
        name="Owner", role="owner", department_id=department.id, is_active=True,
    )
    db.add(owner)
    db.flush()
    campaign = foundation.MarketingCampaign(
        name="Room promotions", department_id=department.id, owner_id=owner.id,
    )
    db.add(campaign)
    db.flush()
    try:
        yield db, owner, campaign
    finally:
        db.close()
        engine.dispose()


def add_concept(db, campaign, title, platforms=("Facebook",)):
    concept = foundation.ContentConcept(
        campaign_id=campaign.id, title=title, content_pillar="Experience",
    )
    db.add(concept)
    db.flush()
    deliverables = []
    for platform in platforms:
        row = foundation.PlatformDeliverable(
            concept_id=concept.id, platform=platform, format="Static",
        )
        db.add(row)
        deliverables.append(row)
    db.commit()
    return concept, deliverables


def publish(db, user, deliverable):
    transition_deliverable(db, user, deliverable.id, "start-draft")
    transition_deliverable(db, user, deliverable.id, "submit-review")
    transition_deliverable(db, user, deliverable.id, "approve")
    deliverable.scheduled_at = utc_now() + timedelta(days=1)
    db.commit()
    transition_deliverable(db, user, deliverable.id, "schedule")
    return transition_deliverable(
        db, user, deliverable.id, "publish",
        final_url=f"https://example.com/posts/{deliverable.id}",
    )


def test_first_draft_immediately_updates_concept_and_campaign_without_autoflush(context):
    db, owner, campaign = context
    concept, deliverables = add_concept(db, campaign, "Weekend sunset")
    updated = transition_deliverable(db, owner, deliverables[0].id, "start-draft")
    db.refresh(concept)
    db.refresh(campaign)
    assert updated.status == "Draft"
    assert concept.status == "Active"
    assert campaign.status == "Active"


def test_final_publication_immediately_completes_both_parents(context):
    db, owner, campaign = context
    concept, deliverables = add_concept(db, campaign, "Suite tour")
    published = publish(db, owner, deliverables[0])
    db.refresh(concept)
    db.refresh(campaign)
    assert published.status == "Published"
    assert concept.status == "Completed"
    assert campaign.status == "Completed"


def test_multiple_platforms_complete_only_after_last_is_published(context):
    db, owner, campaign = context
    concept, deliverables = add_concept(
        db, campaign, "New room photos", ("Facebook", "Instagram"),
    )
    publish(db, owner, deliverables[0])
    db.refresh(concept)
    db.refresh(campaign)
    assert concept.status == "Active"
    assert campaign.status == "Active"
    publish(db, owner, deliverables[1])
    db.refresh(concept)
    db.refresh(campaign)
    assert concept.status == "Completed"
    assert campaign.status == "Completed"


def test_multiple_concepts_complete_campaign_only_after_last_concept(context):
    db, owner, campaign = context
    first, first_deliverables = add_concept(db, campaign, "Room tour")
    second, second_deliverables = add_concept(db, campaign, "Breakfast promo")
    publish(db, owner, first_deliverables[0])
    db.refresh(first)
    db.refresh(second)
    db.refresh(campaign)
    assert first.status == "Completed"
    assert second.status == "Idea"
    assert campaign.status == "Active"
    publish(db, owner, second_deliverables[0])
    db.refresh(second)
    db.refresh(campaign)
    assert second.status == "Completed"
    assert campaign.status == "Completed"


def test_reopening_published_content_reverts_completed_parents_immediately(context):
    db, owner, campaign = context
    concept, deliverables = add_concept(db, campaign, "Campaign to revise")
    publish(db, owner, deliverables[0])
    assert transition_deliverable(
        db, owner, deliverables[0].id, "reopen", "Update photos",
    ).status == "Draft"
    db.refresh(concept)
    db.refresh(campaign)
    assert concept.status == "Active"
    assert campaign.status == "Active"


def test_invalid_transition_does_not_mutate_parent_or_create_audit(context):
    db, owner, campaign = context
    concept, deliverables = add_concept(db, campaign, "No premature publication")
    with pytest.raises(HTTPException) as exc:
        transition_deliverable(db, owner, deliverables[0].id, "publish", "Too soon")
    assert exc.value.status_code == 409
    db.commit()
    db.refresh(concept)
    db.refresh(campaign)
    assert concept.status == "Idea"
    assert campaign.status == "Planning"
    assert db.query(models.ActivityLog).count() == 0


def test_orphaned_concept_is_a_controlled_conflict(context):
    db, owner, _campaign = context
    row = foundation.PlatformDeliverable(
        concept_id=987654, platform="Instagram", format="Reel", status="Planned",
    )
    db.add(row)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        transition_deliverable(db, owner, row.id, "start-draft")
    assert exc.value.status_code == 409
    db.commit()
    db.refresh(row)
    assert row.status == "Planned"
