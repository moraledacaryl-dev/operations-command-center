"""PATCH must authorize the original department as well as the new one.

The editor previously used the payload's target department in place of the
record's current department, enabling a lead to pull a foreign record into
their own department through a guessed record ID.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.authorized_crud import update_resource_authorized


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    first = models.Department(name="Reception")
    second = models.Department(name="Maintenance")
    third = models.Department(name="Events")
    db.add_all([first, second, third])
    db.flush()
    actors = {}
    for role in ("owner", "admin", "manager", "lead", "supervisor", "staff"):
        actor = models.User(
            name=role.title(), email=f"{role}@example.test",
            role=role, department_id=first.id, is_active=True,
        )
        db.add(actor)
        db.flush()
        actors[role] = actor
        db.add(models.UserDepartment(
            user_id=actor.id, department_id=first.id, is_primary=True,
        ))
    db.commit()
    try:
        yield db, first, second, third, actors
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize("resource,model", [
    ("tasks", models.Task),
    ("requests", models.Request),
    ("fixes", models.Fix),
    ("projects", models.Project),
    ("guests", models.GuestNote),
])
@pytest.mark.parametrize("role", ["lead", "supervisor", "manager"])
def test_cannot_take_foreign_record_by_reassigning_to_own_department(
    context, resource, model, role,
):
    db, first, second, _, actors = context
    row = model(title=f"{resource} confidential", department_id=second.id)
    db.add(row)
    db.commit()
    prior_count = db.query(models.ActivityLog).count()
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            resource, row.id,
            {"department_id": first.id, "title": "Unlawfully moved"},
            user=actors[role], db=db,
        )
    assert exc.value.status_code == 403
    # Even a subsequent commit must not persist a partially applied edit.
    db.commit()
    db.refresh(row)
    assert row.department_id == second.id
    assert row.title == f"{resource} confidential"
    assert db.query(models.ActivityLog).count() == prior_count


@pytest.mark.parametrize("target", ["foreign", "unscoped"])
@pytest.mark.parametrize("role", ["lead", "supervisor", "manager"])
def test_source_department_editor_cannot_move_record_to_unmanaged_scope(context, role, target):
    db, first, second, _, actors = context
    row = models.Task(title="Door maintenance", department_id=first.id)
    db.add(row)
    db.commit()
    destination = second.id if target == "foreign" else None
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            "tasks", row.id, {"department_id": destination},
            user=actors[role], db=db,
        )
    assert exc.value.status_code == 403
    db.commit()
    db.refresh(row)
    assert row.department_id == first.id
    assert db.query(models.ActivityLog).count() == 0


@pytest.mark.parametrize("role", ["lead", "supervisor", "manager"])
def test_valid_secondary_membership_allows_reassignment_between_managed_departments(context, role):
    db, first, second, _, actors = context
    db.add(models.UserDepartment(
        user_id=actors[role].id, department_id=second.id, is_primary=False,
    ))
    row = models.Task(title="Cross-team approved", department_id=first.id)
    db.add(row)
    db.commit()
    result = update_resource_authorized(
        "tasks", row.id,
        {"department_id": second.id, "title": "Now handled by maintenance"},
        user=actors[role], db=db,
    )
    assert result["department_id"] == second.id
    assert result["title"] == "Now handled by maintenance"
    assert db.query(models.ActivityLog).count() == 1


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_executives_can_intentionally_reassign_between_or_outside_departments(context, role):
    db, first, second, _, actors = context
    row = models.Task(title="Executive routing", department_id=second.id)
    db.add(row)
    db.commit()
    outcome = update_resource_authorized(
        "tasks", row.id, {"department_id": first.id},
        user=actors[role], db=db,
    )
    assert outcome["department_id"] == first.id
    outcome = update_resource_authorized(
        "tasks", row.id, {"department_id": None},
        user=actors[role], db=db,
    )
    assert outcome["department_id"] is None


def test_normal_same_department_edit_is_still_allowed(context):
    db, first, _, _, actors = context
    row = models.Task(title="Check arrivals", department_id=first.id)
    db.add(row)
    db.commit()
    result = update_resource_authorized(
        "tasks", row.id, {"title": "Check guest arrivals"},
        user=actors["lead"], db=db,
    )
    assert result["title"] == "Check guest arrivals"
    assert result["department_id"] == first.id


def test_department_reassignment_validation_precedes_all_mutations(context):
    db, first, second, _, actors = context
    row = models.Task(title="Restricted", department_id=second.id)
    db.add(row)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        update_resource_authorized(
            "tasks", row.id,
            {"department_id": first.id, "assigned_to_id": actors["staff"].id},
            user=actors["lead"], db=db,
        )
    assert exc.value.status_code == 403
    db.commit()
    db.refresh(row)
    assert row.assigned_to_id is None
    assert row.department_id == second.id
    assert db.query(models.ActivityLog).count() == 0
