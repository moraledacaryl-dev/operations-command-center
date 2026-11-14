"""Bar staff boundaries and Marketing area classification with existing records."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models, foundation_models as fm
from app.authorization_policy import Action, authorize_action, scope_query
from app.marketing_areas import validate_marketing_areas
from app.routers.bar import BarReport, BarTaskAssignment, report_bar_problem, assign_bar_report
from app.routers.api import WorkflowPayload, workflow_create_task, router as api_router
from app.routers.api import require_user
from app.database import get_db
from app.routers.workflow import router as workflow_router
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.authorized_crud import create_resource_authorized, update_resource_authorized
from app.routers.marketing import (
    CampaignCreate, ConceptCreate, MarketingAreasUpdate, create_campaign,
    create_concept, update_campaign_areas, update_concept_areas,
)
from app.domain_values import ContentFormat, Platform, MarketingArea


@pytest.fixture
def context():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    cafe = models.Department(name="Café")
    kitchen = models.Department(name="Kitchen")
    bar = models.Department(name="Bar")
    marketing = models.Department(name="Marketing")
    housekeeping = models.Department(name="Housekeeping")
    db.add_all([cafe, kitchen, bar, marketing, housekeeping])
    db.flush()
    bartender = models.User(name="Demo bartender", role="staff", department_id=bar.id, is_active=True)
    cafe_staff = models.User(name="Demo cafe", role="staff", department_id=cafe.id, is_active=True)
    bar_lead = models.User(name="Demo Bar lead", role="lead", department_id=bar.id, is_active=True)
    marketer = models.User(name="Demo Marketing lead", role="lead", department_id=marketing.id, is_active=True)
    db.add_all([bartender, cafe_staff, bar_lead, marketer])
    db.flush()
    for user, department in ((bartender, bar), (bartender, kitchen), (bartender, housekeeping),
                             (cafe_staff, cafe), (bar_lead, bar), (marketer, marketing)):
        db.add(models.UserDepartment(user_id=user.id, department_id=department.id,
                                     is_primary=user.department_id == department.id))
    old_cafe = models.ShiftNote(title="Old café note", department_id=cafe.id)
    old_kitchen = models.Task(title="Old kitchen task", department_id=kitchen.id)
    old_post = models.Post(title="Old post", department_id=marketing.id, status="Idea")
    old_campaign = fm.MarketingCampaign(department_id=marketing.id, name="Old event")
    db.add_all([old_cafe, old_kitchen, old_post, old_campaign])
    db.commit()
    try:
        yield db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, bar_lead, marketer, old_cafe, old_kitchen, old_post, old_campaign
    finally:
        db.close()
        engine.dispose()


def expect_denied(call, code=403):
    with pytest.raises(HTTPException) as exc:
        call()
    assert exc.value.status_code == code


def test_bar_staff_can_report_but_not_create_or_assign_general_tasks(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, marketer, old_cafe, old_kitchen, *_ = context
    created = report_bar_problem(BarReport(
        title="Mocktail blender failed", kind="Equipment",
        details="Blender stopped at the Bar; do not use until checked.",
        shift="PM", urgency="High",
    ), user=bartender, db=db)
    assert created["department_id"] == bar.id
    assert created["submitted_by_id"] == bartender.id
    assert created["status"] == "New"
    assert created["category"] == "Equipment"
    assert db.get(models.ShiftNote, old_cafe.id).department_id == cafe.id
    assert db.get(models.Task, old_kitchen.id).department_id == kitchen.id
    expect_denied(lambda: create_resource_authorized("tasks", {"title": "Assign to anyone", "department_id": bar.id}, bartender, db))
    expect_denied(lambda: authorize_action(db, bartender, "users", Action.CREATE))
    expect_denied(lambda: authorize_action(db, bartender, "posts", Action.EDIT, department_id=marketing.id))
    expect_denied(lambda: report_bar_problem(BarReport(title="Stock low", kind="Low stock", details="Bar syrup is low."), user=cafe_staff, db=db))
    assert db.query(models.ShiftNote).filter_by(department_id=bar.id).count() == 1


def test_bar_membership_is_independent_from_kitchen_cafe_and_housekeeping(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, *_ = context
    for department in (bar, kitchen, housekeeping):
        authorize_action(db, bartender, "shift-notes", Action.VIEW, department_id=department.id)
    expect_denied(lambda: authorize_action(db, bartender, "shift-notes", Action.VIEW, department_id=cafe.id))
    expect_denied(lambda: authorize_action(db, cafe_staff, "shift-notes", Action.VIEW, department_id=bar.id))
    note = models.ShiftNote(title="New Bar note", department_id=bar.id)
    db.add(note)
    db.commit()
    visible = scope_query(db, cafe_staff, models.ShiftNote, db.query(models.ShiftNote)).all()
    assert all(row.department_id == cafe.id for row in visible)
    lead_task = create_resource_authorized("tasks", {"title": "Check Bar blender", "department_id": bar.id}, lead, db)
    assert lead_task["department_id"] == bar.id
    expect_denied(lambda: create_resource_authorized("tasks", {"title": "Wrong department", "department_id": cafe.id}, lead, db))


def test_bar_report_assignment_is_linked_visible_and_idempotent(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, *_ = context
    report = report_bar_problem(BarReport(title="Blender stopped", kind="Equipment",
        details="Do not use the blender until it is checked.", urgency="High"), bartender, db)
    assignment = BarTaskAssignment(assigned_to_id=bartender.id)
    result = assign_bar_report(report["id"], assignment, lead, db)
    task = db.get(models.Task, result["task"]["id"])
    assert result["created"] is True
    assert db.get(models.ShiftNote, report["id"]).linked_task_id == task.id
    assert (task.department_id, task.assigned_to_id, task.status, task.priority) == (bar.id, bartender.id, "To Do", "High")
    assert "blender" in task.note
    assert scope_query(db, bartender, models.Task, db.query(models.Task)).filter_by(id=task.id).one().id == task.id
    again = assign_bar_report(report["id"], assignment, lead, db)
    assert again["created"] is False and again["task"]["id"] == task.id
    assert db.query(models.Task).filter_by(title="Blender stopped").count() == 1
    assert db.query(fm.Notification).filter_by(user_id=bartender.id, source_type="tasks", source_id=str(task.id)).count() == 1
    expect_denied(lambda: assign_bar_report(report["id"], BarTaskAssignment(assigned_to_id=lead.id), lead, db), 409)


def test_bar_report_assignment_rejects_wrong_permissions_and_department(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, *_ = context
    report = report_bar_problem(BarReport(title="Broken bottle", kind="Other", details="Keep the area clear for cleaning."), bartender, db)
    expect_denied(lambda: assign_bar_report(report["id"], BarTaskAssignment(assigned_to_id=bartender.id), bartender, db))
    expect_denied(lambda: assign_bar_report(report["id"], BarTaskAssignment(assigned_to_id=cafe_staff.id), lead, db))
    expect_denied(lambda: assign_bar_report(report["id"], BarTaskAssignment(assigned_to_id=bartender.id), cafe_staff, db))
    bartender.is_active = False; db.flush()
    expect_denied(lambda: assign_bar_report(report["id"], BarTaskAssignment(assigned_to_id=bartender.id), lead, db), 422)
    assert db.get(models.ShiftNote, report["id"]).linked_task_id is None
    assert db.query(models.Task).filter_by(title="Broken bottle").count() == 0
    other = models.ShiftNote(title="Café note", department_id=cafe.id, status="New")
    db.add(other); db.commit()
    expect_denied(lambda: assign_bar_report(other.id, BarTaskAssignment(assigned_to_id=bartender.id), lead, db), 404)


def test_bar_report_assignment_rejects_finished_or_archived_reports(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, *_ = context
    report = models.ShiftNote(title="Finished report", department_id=bar.id, status="Done")
    db.add(report); db.commit()
    expect_denied(lambda: assign_bar_report(report.id, BarTaskAssignment(assigned_to_id=bartender.id), lead, db), 409)
    report.status = "New"; report.hidden_from_active = True; db.commit()
    expect_denied(lambda: assign_bar_report(report.id, BarTaskAssignment(assigned_to_id=bartender.id), lead, db), 409)


def test_existing_followup_endpoint_requires_task_creation_permission(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, *_ = context
    note = models.ShiftNote(title="Follow up blender", department_id=bar.id, status="New")
    db.add(note); db.commit()
    expect_denied(lambda: workflow_create_task("shift-notes", note.id, WorkflowPayload(), bartender, db))
    assert db.get(models.ShiftNote, note.id).linked_task_id is None
    assert db.query(models.Task).filter_by(title="Follow up blender").count() == 0
    result = workflow_create_task("shift-notes", note.id, WorkflowPayload(), lead, db)
    assert db.get(models.ShiftNote, note.id).linked_task_id == result["task"]["id"]


def test_project_task_route_reaches_creation_and_checks_permissions(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, *_ = context
    project = models.Project(title="Fictional Bar event", department_id=bar.id, status="Planned")
    db.add(project); db.commit()
    app = FastAPI()
    app.include_router(workflow_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_user] = lambda: bartender
    with TestClient(app) as client:
        denied = client.post(f"/api/workflow/projects/{project.id}/create-task", json={"note": "Prepare the bar"})
        assert denied.status_code == 403
        assert db.query(models.Task).filter_by(project_id=project.id).count() == 0
        app.dependency_overrides[require_user] = lambda: lead
        created = client.post(f"/api/workflow/projects/{project.id}/create-task", json={"note": "Prepare the bar"})
        assert created.status_code == 200
        task = db.get(models.Task, created.json()["task"]["id"])
        assert task.project_id == project.id and task.department_id == bar.id
        assert task.note == "Prepare the bar"


def test_generic_fix_followup_route_denies_staff_but_allows_lead(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, *_ = context
    fix = models.Fix(title="Fictional Bar repair", department_id=bar.id, status="Open")
    db.add(fix); db.commit()
    app = FastAPI()
    app.include_router(workflow_router)
    app.include_router(api_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_user] = lambda: bartender
    with TestClient(app) as client:
        denied = client.post(f"/api/workflow/fixes/{fix.id}/create-task", json={})
        assert denied.status_code == 403
        assert db.get(models.Fix, fix.id).linked_task_id is None
        app.dependency_overrides[require_user] = lambda: lead
        created = client.post(f"/api/workflow/fixes/{fix.id}/create-task", json={})
        assert created.status_code == 200
        assert db.get(models.Fix, fix.id).linked_task_id == created.json()["task"]["id"]


def test_marketing_tags_preserve_old_records_and_can_be_edited(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, marketer, old_cafe, old_kitchen, old_post, old_campaign = context
    assert old_post.marketing_areas is None
    assert old_campaign.marketing_areas is None
    campaign = create_campaign(CampaignCreate(department_id=marketing.id, name="Fictional drinks event",
        marketing_areas=[MarketingArea.CAFE, MarketingArea.BAR]), user=marketer, db=db)
    assert campaign["marketing_areas"] == ["Café", "Bar"]
    created = create_concept(ConceptCreate(
        campaign_id=campaign["id"], title="Mocktail and coffee night",
        marketing_areas=[MarketingArea.CAFE, MarketingArea.BAR],
        platforms=[Platform.FACEBOOK], format=ContentFormat.STATIC,
    ), user=marketer, db=db)
    assert created["concept"]["marketing_areas"] == ["Café", "Bar"]
    changed = update_campaign_areas(old_campaign.id, MarketingAreasUpdate(
        marketing_areas=[MarketingArea.POOL]), user=marketer, db=db)
    assert changed["marketing_areas"] == ["Pool"]
    update_concept_areas(created["concept"]["id"],
        MarketingAreasUpdate(marketing_areas=[MarketingArea.ROOMS, MarketingArea.POOL]),
        user=marketer, db=db)
    assert db.get(fm.ContentConcept, created["concept"]["id"]).marketing_areas == ["Rooms", "Pool"]
    assert db.get(models.Post, old_post.id).marketing_areas is None
    result = update_resource_authorized("posts", old_post.id, {"marketing_areas": ["Kitchen", "Bar"]}, marketer, db)
    assert result["marketing_areas"] == ["Kitchen", "Bar"]
    expect_denied(lambda: update_campaign_areas(campaign["id"],
        MarketingAreasUpdate(marketing_areas=[MarketingArea.BAR]), user=cafe_staff, db=db))
    assert db.get(models.Post, old_post.id).department_id == marketing.id


def test_invalid_or_duplicate_areas_and_unrelated_department_tags_are_rejected(context):
    db, cafe, kitchen, bar, marketing, housekeeping, bartender, cafe_staff, lead, marketer, *_ = context
    for areas in ([], ["Pool", "Pool"], ["Wrong"], ["Rooms", "Pool", "Bar", "Café", "Kitchen", "Kitchen"]):
        expect_denied(lambda: validate_marketing_areas(areas), 422)
    expect_denied(lambda: create_resource_authorized("tasks", {
        "title": "Bar task", "department_id": bar.id, "marketing_areas": ["Bar"]}, lead, db), 422)
    item = create_resource_authorized("tasks", {
        "title": "Pool post plan", "department_id": marketing.id, "marketing_areas": ["Pool"]}, marketer, db)
    assert item["marketing_areas"] == ["Pool"]
    updated = update_resource_authorized("tasks", item["id"], {
        "marketing_areas": ["Café", "Bar"]}, marketer, db)
    assert updated["marketing_areas"] == ["Café", "Bar"]
