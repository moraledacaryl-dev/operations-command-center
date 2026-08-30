import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.authorized_crud import update_resource_authorized
from app.schemas.resources import validate_resource_payload
from app.services.operational_workflow import transition_operational


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def owner_with_departments(db):
    first = models.Department(name="Front Desk")
    second = models.Department(name="Marketing")
    db.add_all([first, second])
    db.flush()
    owner = models.User(
        name="Owner",
        email="owner@example.com",
        role="owner",
        department_id=first.id,
        is_active=True,
    )
    db.add(owner)
    db.flush()
    db.add(models.UserDepartment(user_id=owner.id, department_id=first.id, is_primary=True))
    db.commit()
    return owner, first, second


def test_required_create_fields_and_unknown_keys_are_rejected():
    for resource in ("departments", "rooms", "talk"):
        with pytest.raises(ValidationError):
            validate_resource_payload(resource, {})

    with pytest.raises(ValidationError) as exc:
        validate_resource_payload("departments", {"name": "Operations", "mystery": "ignored-before"})
    assert any(error["type"] == "extra_forbidden" for error in exc.value.errors())

    with pytest.raises(ValidationError):
        validate_resource_payload("tasks", {"title": "Invalid", "priority": "Eventually"})
    with pytest.raises(ValidationError):
        validate_resource_payload("rooms", {"name": "Invalid", "kind": "Spaceship"})


def test_negative_limit_contract_is_declared_on_collection_route():
    route = next(
        route
        for route in __import__("app.main", fromlist=["app"]).app.routes
        if getattr(route, "path", None) == "/api/{resource}" and "GET" in getattr(route, "methods", set())
    )
    limit = next(parameter for parameter in route.dependant.query_params if parameter.name == "limit")
    assert limit.field_info.metadata
    assert any(getattr(item, "ge", None) == 1 for item in limit.field_info.metadata)
    assert any(getattr(item, "le", None) == 500 for item in limit.field_info.metadata)


def test_task_status_cannot_be_changed_through_generic_patch(db):
    owner, department, _ = owner_with_departments(db)
    task = models.Task(title="Task", department_id=department.id, status="To Do")
    db.add(task)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            "tasks",
            task.id,
            {"status": "Done"},
            user=owner,
            db=db,
        )
    assert exc.value.status_code == 405
    db.refresh(task)
    assert task.status == "To Do"
    assert task.completed_at is None


def test_task_progression_sets_completion_and_blocks_regression(db):
    owner, department, _ = owner_with_departments(db)
    task = models.Task(title="Task", department_id=department.id, status="To Do")
    db.add(task)
    db.commit()

    transition_operational(db, owner, "tasks", task.id, "start")
    transition_operational(db, owner, "tasks", task.id, "submit-review")
    result = transition_operational(db, owner, "tasks", task.id, "complete")
    assert result.status == "Done"
    assert result.completed_at is not None

    with pytest.raises(HTTPException) as exc:
        transition_operational(db, owner, "tasks", task.id, "reopen")
    assert exc.value.status_code == 400

    reopened = transition_operational(db, owner, "tasks", task.id, "reopen", "Additional work is required")
    assert reopened.status == "Doing"


def test_duplicate_membership_is_impossible_in_metadata_schema(db):
    owner, department, _ = owner_with_departments(db)
    db.add(models.UserDepartment(user_id=owner.id, department_id=department.id, is_primary=False))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_multiple_primary_memberships_are_impossible_in_metadata_schema(db):
    owner, _, second = owner_with_departments(db)
    db.add(models.UserDepartment(user_id=owner.id, department_id=second.id, is_primary=True))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
