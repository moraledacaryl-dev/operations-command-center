"""Staff Guide access control, publication and reading evidence.

Scenarios use invented employee names and an isolated in-memory database.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from datetime import timedelta
from app import models
from app.clock import utc_now
from app.services.guide_reminders import send_due_reminders
from app.routers.staff_guide import download_guide_file
from app import foundation_models as fm
from app.staff_guide_models import GuideAcknowledgment, GuideReading, GuideRevision
from app.routers.notifications import _visible_notifications
from app.routers.staff_guide import (
    DraftPayload, EditPayload, PublishPayload,
    create_guide, edit_guide, get_guide, list_guides, my_reading,
    submit_guide, approve_guide, publish_guide, acknowledge_guide,
)


@pytest.fixture
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    bar = models.Department(name="Bar")
    cafe = models.Department(name="Café")
    rooms = models.Department(name="Housekeeping")
    db.add_all([bar, cafe, rooms])
    db.flush()
    owner = models.User(name="Demo owner", role="owner", is_active=True)
    lead = models.User(name="Demo bar lead", role="lead", department_id=bar.id, is_active=True)
    bar_staff = models.User(name="Demo bar worker", role="staff", department_id=bar.id, is_active=True)
    cafe_staff = models.User(name="Demo café worker", role="staff", department_id=cafe.id, is_active=True)
    multi = models.User(name="Demo cross-trained worker", role="staff", department_id=cafe.id, is_active=True)
    house = models.User(name="Demo house worker", role="staff", department_id=rooms.id, is_active=True)
    inactive = models.User(name="Inactive worker", role="staff", department_id=bar.id, is_active=False)
    db.add_all([owner, lead, bar_staff, cafe_staff, multi, house, inactive])
    db.flush()
    db.add(models.UserDepartment(user_id=multi.id, department_id=bar.id))
    db.commit()
    yield db, bar, cafe, rooms, owner, lead, bar_staff, cafe_staff, multi, house, inactive
    db.close()
    engine.dispose()


def reject(status, fn):
    with pytest.raises(HTTPException) as exc:
        fn()
    assert exc.value.status_code == status


def make_guide(db, owner, departments, *, audience="departments", ack=True, title="Bar closing instructions"):
    return create_guide(DraftPayload(
        title=title, doc_type="SOP", category="Closing",
        body="1. Count the bottles.\n2. Clean the counter.\n3. Tell the next shift.",
        summary="Steps for closing duty.",
        audience=audience, department_ids=departments,
        requires_ack=ack,
    ), owner, db)["id"]


def publish(db, owner, document_id):
    submit_guide(document_id, owner, db)
    approve_guide(document_id, owner, db)
    return publish_guide(document_id, PublishPayload(), owner, db)


def test_drafts_do_not_notify_or_leak_to_staff(context):
    db, bar, _, _, owner, _, bartender, _, _, _, _ = context
    doc_id = make_guide(db, owner, [bar.id])
    assert db.query(fm.Notification).count() == 0
    reject(404, lambda: get_guide(doc_id, bartender, db))
    assert list_guides("", "", bartender, db) == []
    submit_guide(doc_id, owner, db)
    approve_guide(doc_id, owner, db)
    assert db.query(fm.Notification).count() == 0
    reject(404, lambda: get_guide(doc_id, bartender, db))


def test_publish_targets_only_relevant_active_people_and_deduplicates(context):
    db, bar, cafe, _, owner, lead, bartender, cafe_staff, multi, house, inactive = context
    doc_id = make_guide(db, owner, [bar.id, cafe.id])
    publish(db, owner, doc_id)
    notices = db.query(fm.Notification).filter_by(source_type="staff-guide", source_id=str(doc_id)).all()
    recipient_ids = [n.user_id for n in notices]
    assert len(recipient_ids) == len(set(recipient_ids))
    assert set(recipient_ids) == {owner.id, lead.id, bartender.id, cafe_staff.id, multi.id}
    assert house.id not in recipient_ids and inactive.id not in recipient_ids
    assert db.query(GuideReading).count() == len(recipient_ids)
    assert len(list_guides("", "", multi, db)) == 1
    assert list_guides("", "", house, db) == []


def test_acknowledgment_is_explicit_revision_specific_and_idempotent(context):
    db, bar, _, _, owner, _, bartender, _, _, _, _ = context
    doc_id = make_guide(db, owner, [bar.id])
    publish(db, owner, doc_id)
    assert get_guide(doc_id, bartender, db)["published"]["acknowledged"] is False
    assert len(my_reading(bartender, db)) == 1
    first = acknowledge_guide(doc_id, bartender, db)
    second = acknowledge_guide(doc_id, bartender, db)
    assert first["revision_id"] == second["revision_id"]
    assert db.query(GuideAcknowledgment).filter_by(user_id=bartender.id).count() == 1
    assert my_reading(bartender, db)[0]["acknowledged"] is True
    first_revision = db.get(GuideRevision, first["revision_id"])
    original = first_revision.body
    edit_guide(doc_id, EditPayload(body="Revised safe closing steps."), owner, db)
    assert get_guide(doc_id, bartender, db)["published"]["body"] == original
    publish(db, owner, doc_id)
    updated = get_guide(doc_id, bartender, db)["published"]
    assert updated["version"] == 2 and updated["acknowledged"] is False
    assert first_revision.body == original
    assert db.query(GuideAcknowledgment).filter_by(user_id=bartender.id).count() == 1
    assert db.query(GuideReading).filter_by(user_id=bartender.id).count() == 2


def test_leads_can_draft_department_guides_but_never_approve_or_publish(context):
    db, bar, cafe, _, owner, lead, _, _, _, _, _ = context
    own = make_guide(db, lead, [bar.id])
    reject(403, lambda: create_guide(DraftPayload(
        title="Café cash rule", body="A rule", department_ids=[cafe.id],
    ), lead, db))
    reject(403, lambda: create_guide(DraftPayload(
        title="All-staff attendance policy", body="A rule",
        audience="all", department_ids=[],
    ), lead, db))
    submit_guide(own, lead, db)
    reject(403, lambda: approve_guide(own, lead, db))
    reject(403, lambda: publish_guide(own, PublishPayload(), lead, db))
    approve_guide(own, owner, db)
    publish_guide(own, PublishPayload(), owner, db)


def test_manager_only_and_company_wide_access(context):
    db, _, _, _, owner, _, bartender, cafe_staff, _, _, _ = context
    restricted = make_guide(db, owner, [], audience="management", title="Manager escalation")
    company = make_guide(db, owner, [], audience="all", title="General conduct policy")
    publish(db, owner, restricted)
    publish(db, owner, company)
    reject(404, lambda: get_guide(restricted, bartender, db))
    assert get_guide(company, bartender, db)["published"]["title"] == "General conduct policy"
    assert get_guide(company, cafe_staff, db)["published"]["title"] == "General conduct policy"
    restricted_notices = db.query(fm.Notification).filter_by(source_id=str(restricted)).all()
    assert {n.user_id for n in restricted_notices} == {owner.id}


def test_notification_visibility_follows_revoked_and_restored_membership(context):
    db, bar, _, house, owner, _, bartender, _, multi, _, _ = context
    doc_id = make_guide(db, owner, [bar.id])
    publish(db, owner, doc_id)
    assert _visible_notifications(db, bartender).filter_by(source_id=str(doc_id)).count() == 1
    bartender.department_id = house.id
    db.commit()
    assert _visible_notifications(db, bartender).filter_by(source_id=str(doc_id)).count() == 0
    reject(404, lambda: get_guide(doc_id, bartender, db))
    assert _visible_notifications(db, multi).filter_by(source_id=str(doc_id)).count() == 1
    db.query(models.UserDepartment).filter_by(user_id=multi.id, department_id=bar.id).delete()
    db.commit()
    assert _visible_notifications(db, multi).filter_by(source_id=str(doc_id)).count() == 0
    db.add(models.UserDepartment(user_id=multi.id, department_id=bar.id))
    db.commit()
    assert _visible_notifications(db, multi).filter_by(source_id=str(doc_id)).count() == 1


def test_cannot_acknowledge_without_access_or_ack_requirement(context):
    db, bar, _, _, owner, _, bartender, _, _, house, _ = context
    doc_id = make_guide(db, owner, [bar.id], ack=False)
    publish(db, owner, doc_id)
    reject(409, lambda: acknowledge_guide(doc_id, bartender, db))
    reject(404, lambda: acknowledge_guide(doc_id, house, db))


def test_overdue_reminders_are_scoped_and_idempotent(context):
    db, bar, _, house, owner, _, bartender, _, multi, _, _ = context
    doc_id = make_guide(db, owner, [bar.id])
    publish(db, owner, doc_id)
    due = utc_now() - timedelta(days=1)
    for row in db.query(GuideReading).all():
        row.due_at = due
    # This employee was reassigned away from Bar after publishing.
    bartender.department_id = house.id
    db.commit()
    first = send_due_reminders(db)
    assert first == 3  # owner, Bar lead and cross-trained worker
    second = send_due_reminders(db)
    assert second == 0
    notices = db.query(fm.Notification).filter_by(kind="staff-guide-reminder").all()
    assert len({n.user_id for n in notices}) == len(notices)


def test_unauthorized_guide_file_download_does_not_leak_attachment(context):
    db, bar, _, _, owner, _, _, _, _, house, _ = context
    doc_id = make_guide(db, owner, [bar.id])
    publish(db, owner, doc_id)
    rev_id = get_guide(doc_id, owner, db)["published"]["id"]
    attachment = models.Attachment(
        parent_type="staff-guide-revision", parent_id=rev_id,
        filename="confidential.pdf", file_url="storage:missing-file.pdf")
    db.add(attachment)
    db.commit()
    reject(404, lambda: download_guide_file(attachment.id, house, db))


def test_new_department_member_sees_policy_and_gets_single_assignment(context):
    db, bar, _, _, owner, _, _, _, _, _, _ = context
    doc_id = make_guide(db, owner, [bar.id])
    publish(db, owner, doc_id)
    newcomer = models.User(name="New Demo worker", role="staff", department_id=bar.id, is_active=True)
    db.add(newcomer)
    db.commit()
    assert my_reading(newcomer, db)[0]["acknowledged"] is False
    assert my_reading(newcomer, db)[0]["due_at"] is None
    assert db.query(GuideReading).filter_by(user_id=newcomer.id).count() == 0
    send_due_reminders(db)
    assert db.query(GuideReading).filter_by(user_id=newcomer.id).count() == 1
    notifications = db.query(fm.Notification).filter_by(
        user_id=newcomer.id, source_type="staff-guide").all()
    assert len(notifications) == 1
    send_due_reminders(db)
    assert db.query(fm.Notification).filter_by(
        user_id=newcomer.id, source_type="staff-guide").count() == 1
