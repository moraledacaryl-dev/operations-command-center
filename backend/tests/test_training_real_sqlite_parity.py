"""Train against the real operational services and transactional SQLite data.

These tests are intentionally NOT browser mocks. They execute the same domain
functions used by the production API, but only in an in-memory fictional DB.
No external integrations, production credentials, or VPS are contacted.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.guest_workflow import create_fix_from_guest
from app.services.fix_workflow import start_fix, finish_fix, verify_fix
from app.services.request_workflow import submit_request
from app.services.operational_workflow import transition_operational
from app.authorization_policy import authorize_action, Action


@pytest.fixture()
def training_database():
    engine = create_engine("sqlite:///:memory:", future=True)
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, future=True)()
    front = models.Department(name="Fictional Front Desk")
    maintenance = models.Department(name="Fictional Maintenance")
    db.add_all([front, maintenance])
    db.flush()
    owner = models.User(name="Fictional Owner", role="owner", department_id=front.id, is_active=True)
    manager = models.User(name="Fictional Manager", role="manager", department_id=front.id, is_active=True)
    lead = models.User(name="Fictional Lead", role="lead", department_id=front.id, is_active=True)
    staff = models.User(name="Fictional Staff", role="staff", department_id=front.id, is_active=True)
    maintenance_lead = models.User(name="Fictional Maintenance Lead", role="lead",
                                   department_id=maintenance.id, is_active=True)
    db.add_all([owner, manager, lead, staff, maintenance_lead])
    db.flush()
    for user, dept in ((manager, front), (lead, front), (staff, front),
                       (maintenance_lead, maintenance)):
        db.add(models.UserDepartment(user_id=user.id, department_id=dept.id, is_primary=True))
    db.commit()
    try:
        yield db, front, maintenance, owner, manager, lead, staff, maintenance_lead
    finally:
        db.close()
        engine.dispose()


def guest_note(db, front, ref="TRN-LINK-REALSQL01"):
    guest = models.GuestNote(
        title=f"Shower failure {ref}", department_id=front.id,
        status="Open", urgency="High", issue_type="Room",
        note="The guest shower is cold; Maintenance must inspect and Front Desk call the guest.",
    )
    db.add(guest)
    db.commit()
    return guest


def test_actual_guest_fix_handoff_verification_and_guest_auto_closure(training_database):
    db, front, _, owner, _, _, _, _ = training_database
    guest = guest_note(db, front)
    saved_guest, fix = create_fix_from_guest(db, owner, guest.id)
    assert saved_guest.status == "Follow"
    assert saved_guest.linked_fix_id == fix.id
    assert fix.linked_guest_note_id == guest.id
    assert fix.department_id == front.id  # Important: default does NOT transfer to Maintenance.
    assert fix.title == guest.title
    assert start_fix(db, owner, fix.id).status == "Working"
    assert finish_fix(db, owner, fix.id).status == "Done"
    db.refresh(guest)
    assert guest.status == "Follow"
    verified = verify_fix(db, owner, fix.id, "Fictional water temperature and water supply tested")
    db.refresh(guest)
    assert verified.status == "Verified"
    assert verified.verified_by_id == owner.id
    assert guest.status == "Done"  # The prior training assessment incorrectly demanded Follow.
    assert guest.completed_at is not None
    assert guest.action_taken == "Fictional water temperature and water supply tested"
    assert db.query(models.Fix).count() == 1
    assert db.query(models.Comment).filter_by(parent_type="fixes", parent_id=fix.id, comment_type="Verification").count() == 1


def test_lead_can_progress_repair_but_cannot_verify_it(training_database):
    db, front, _, _, manager, lead, _, _ = training_database
    guest = guest_note(db, front)
    _, fix = create_fix_from_guest(db, lead, guest.id)
    assert start_fix(db, lead, fix.id).status == "Working"
    assert finish_fix(db, lead, fix.id).status == "Done"
    with pytest.raises(HTTPException) as exc:
        verify_fix(db, lead, fix.id, "Attempted supervisor verification")
    assert exc.value.status_code == 403
    db.commit()
    db.refresh(fix)
    db.refresh(guest)
    assert fix.status == "Done"
    assert guest.status == "Follow"
    assert verify_fix(db, manager, fix.id, "Authorized fictional inspection").status == "Verified"
    db.refresh(guest)
    assert guest.status == "Done"


def test_staff_cannot_create_a_fix_via_guest_or_mutate_task(training_database):
    db, front, _, _, _, _, staff, _ = training_database
    guest = guest_note(db, front)
    with pytest.raises(HTTPException) as exc:
        create_fix_from_guest(db, staff, guest.id)
    assert exc.value.status_code == 403
    assert db.query(models.Fix).count() == 0
    task = models.Task(title="Check fictional room", department_id=front.id, status="To Do")
    db.add(task)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        transition_operational(db, staff, "tasks", task.id, "start")
    assert exc.value.status_code == 403


def test_cross_department_routing_is_possible_in_api_but_requires_both_memberships(training_database):
    db, front, maintenance, _, manager, _, _, maintenance_lead = training_database
    guest = guest_note(db, front)
    with pytest.raises(HTTPException) as exc:
        create_fix_from_guest(db, manager, guest.id, department_id=maintenance.id)
    assert exc.value.status_code == 403
    assert db.query(models.Fix).count() == 0
    db.add(models.UserDepartment(user_id=manager.id, department_id=maintenance.id, is_primary=False))
    db.commit()
    saved_guest, fix = create_fix_from_guest(db, manager, guest.id, department_id=maintenance.id)
    assert saved_guest.status == "Follow"
    assert fix.department_id == maintenance.id
    assert fix.linked_guest_note_id == guest.id
    assert start_fix(db, maintenance_lead, fix.id).status == "Working"
    assert finish_fix(db, maintenance_lead, fix.id).status == "Done"
    assert verify_fix(db, manager, fix.id, "Both scoped departments reviewed").status == "Verified"
    db.refresh(guest)
    assert guest.status == "Done"


def test_request_submission_creates_the_exact_pending_approval(training_database):
    db, front, _, _, manager, lead, _, _ = training_database
    request = models.Request(title="Replacement equipment TRN-REQ-REALSQL01",
                             department_id=front.id, status="Draft",
                             request_type="Equipment", urgency="Urgent",
                             reason="Cost PHP 12000, supplier quotation pending; necessary for service.")
    db.add(request)
    db.commit()
    updated, approval = submit_request(db, lead, request.id)
    assert updated.status == "Review"
    assert approval.source_type == "ops_need"
    assert approval.source_id == request.id
    assert approval.department_id == front.id
    assert approval.status == "Pending"
    assert db.query(models.Approval).filter_by(source_type="ops_need", source_id=request.id).count() == 1
    with pytest.raises(HTTPException) as exc:
        submit_request(db, manager, request.id)
    assert exc.value.status_code == 409
    assert db.query(models.Approval).filter_by(source_type="ops_need", source_id=request.id).count() == 1


def test_real_shift_and_task_transitions_respect_saved_states(training_database):
    db, front, _, _, manager, lead, _, _ = training_database
    task = models.Task(title="Assigned follow-up TRN-TASK-REALSQL01",
                       department_id=front.id, status="To Do",
                       priority="High", assigned_to_id=lead.id)
    handover = models.ShiftNote(title="Guest callback TRN-SHIFT-REALSQL01",
                               department_id=front.id, status="New", category="Guest",
                               urgency="Urgent", note="Guest callback pending, Front Desk lead responsible.")
    db.add_all([task, handover])
    db.commit()
    assert transition_operational(db, lead, "tasks", task.id, "start").status == "Doing"
    assert transition_operational(db, lead, "tasks", task.id, "submit-review").status == "Review"
    assert transition_operational(db, manager, "shift-notes", handover.id, "follow-up-new").status == "Follow"


def test_staff_can_read_their_department_task_but_cannot_modify_it(training_database):
    db, front, maintenance, _, _, _, staff, _ = training_database
    own = models.Task(title="[TRAINING] Fictional room inspection",
                      department_id=front.id, status="To Do", priority="High")
    other = models.Task(title="[TRAINING] Fictional restricted maintenance",
                        department_id=maintenance.id, status="Review", priority="Urgent")
    db.add_all([own, other])
    db.commit()

    # The practical reading drill must work using a real staff account, not
    # elevated trainer credentials or a fake API response.
    authorize_action(db, staff, "tasks", Action.VIEW, obj=own)
    from app.authorization_policy import scope_query
    visible = scope_query(db, staff, models.Task, db.query(models.Task)).all()
    assert own in visible and other not in visible
    with pytest.raises(HTTPException) as denied:
        authorize_action(db, staff, "tasks", Action.VIEW, obj=other)
    assert denied.value.status_code == 403
    with pytest.raises(HTTPException) as denied:
        authorize_action(db, staff, "tasks", Action.EDIT, obj=own)
    assert denied.value.status_code == 403
