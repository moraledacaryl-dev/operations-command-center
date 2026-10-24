import pytest
import json
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models as m
from app.foundation_models import Notification
from app.routers.authorized_crud import create_resource_authorized, update_resource_authorized


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front, other = m.Department(name="Front"), m.Department(name="Other")
    db.add_all([front, other]); db.flush()
    executive = m.User(name="Owner", role="owner", department_id=front.id)
    colleague = m.User(name="Colleague", role="staff", department_id=front.id)
    outsider = m.User(name="Outsider", role="staff", department_id=other.id)
    inactive = m.User(name="Inactive", role="staff", department_id=front.id, is_active=False)
    db.add_all([executive, colleague, outsider, inactive]); db.commit()
    yield db, front, other, executive, colleague, outsider, inactive
    db.close(); engine.dispose()


@pytest.mark.parametrize("resource", ["projects", "tasks"])
def test_owner_must_be_active_and_able_to_view_source_department(context, resource):
    db, front, _, actor, _, outsider, inactive = context
    for owner, expected in [(outsider, 403), (inactive, 422)]:
        with pytest.raises(HTTPException) as exc:
            create_resource_authorized(resource, {"title": "Private work", "department_id": front.id,
                                                  "owner_id": owner.id}, user=actor, db=db)
        assert exc.value.status_code == expected
    model = m.Project if resource == "projects" else m.Task
    assert db.query(model).count() == 0
    assert db.query(m.ActivityLog).count() == 0


@pytest.mark.parametrize("resource", ["projects", "tasks"])
def test_owner_update_and_retained_owner_on_department_move_are_validated(context, resource):
    db, front, other, actor, colleague, outsider, _ = context
    item = create_resource_authorized(resource, {"title": "Private work", "department_id": front.id,
                                               "owner_id": colleague.id}, user=actor, db=db)
    for payload in [{"owner_id": outsider.id}, {"department_id": other.id}]:
        with pytest.raises(HTTPException) as exc:
            update_resource_authorized(resource, item["id"], payload, user=actor, db=db)
        assert exc.value.status_code == 403
    model = m.Project if resource == "projects" else m.Task
    row = db.get(model, item["id"])
    assert row.owner_id == colleague.id and row.department_id == front.id


def test_global_read_owner_and_secondary_membership_are_valid_assignments(context):
    db, front, other, actor, _, outsider, _ = context
    db.add(m.UserDepartment(user_id=outsider.id, department_id=front.id)); db.commit()
    item = create_resource_authorized("projects", {"title": "Shared work", "department_id": front.id,
                                                 "owner_id": outsider.id}, user=actor, db=db)
    assert item["owner_id"] == outsider.id
    updated = update_resource_authorized("projects", item["id"], {"owner_id": actor.id,
                                                                 "department_id": other.id}, user=actor, db=db)
    assert updated["owner_id"] == actor.id and updated["department_id"] == other.id


def test_owner_assignment_notifies_once_and_records_reassignment(context):
    db, front, _, actor, colleague, outsider, _ = context
    item = create_resource_authorized("tasks", {"title": "Shared work", "department_id": front.id,
                                               "owner_id": colleague.id, "assigned_to_id": colleague.id}, user=actor, db=db)
    assert db.query(Notification).count() == 1
    assert db.query(Notification).one().user_id == colleague.id
    db.add(m.UserDepartment(user_id=outsider.id, department_id=front.id)); db.commit()
    update_resource_authorized("tasks", item["id"], {"owner_id": outsider.id}, user=actor, db=db)
    assert {notice.user_id for notice in db.query(Notification).all()} == {colleague.id, outsider.id}
    log = db.query(m.ActivityLog).filter_by(action="updated").one()
    assert json.loads(log.metadata_json)["assignment_changes"]["owner_id"] == {
        "previous_id": colleague.id, "new_id": outsider.id,
    }
