"""Source-owned approvals must not be decided after losing source identity."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.services.approval_workflow import decide_approval


@pytest.fixture()
def context():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    department = models.Department(name="Operations")
    db.add(department)
    db.flush()
    owner = models.User(name="Owner", role="owner", department_id=department.id, is_active=True)
    manager = models.User(name="Manager", role="manager", department_id=department.id, is_active=True)
    db.add_all([owner, manager])
    db.flush()
    db.add(models.UserDepartment(user_id=manager.id, department_id=department.id, is_primary=True))
    db.commit()
    try:
        yield db, department, owner, manager
    finally:
        db.close()
        engine.dispose()


@pytest.mark.parametrize("source_type", ["ops_need", "external_review_item"])
@pytest.mark.parametrize("missing_id", [None, 0])
@pytest.mark.parametrize("actor", ["owner", "manager"])
def test_source_owned_pending_approval_cannot_be_decided_without_source_id(
    context, source_type, missing_id, actor,
):
    db, department, owner, manager = context
    approval = models.Approval(
        title="Source link missing",
        source_type=source_type,
        source_id=missing_id,
        department_id=department.id,
        status="Pending",
        note="Imported source awaiting reconciliation",
    )
    db.add(approval)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        decide_approval(db, owner if actor == "owner" else manager, approval.id, "Approved", "Proceed")
    assert exc.value.status_code == 409
    assert "identity is missing" in str(exc.value.detail)
    db.commit()
    db.refresh(approval)
    assert approval.status == "Pending"
    assert approval.decided_by_id is None
    assert approval.decided_at is None
    assert approval.completed_at is None
    assert db.query(models.ActivityLog).count() == 0


def test_standalone_approval_without_source_is_still_actionable(context):
    db, department, owner, _ = context
    approval = models.Approval(title="Standalone approval", department_id=department.id, status="Pending")
    db.add(approval)
    db.commit()
    decided, request, external = decide_approval(db, owner, approval.id, "Approved", "Approved")
    assert decided.status == "Approved"
    assert request is None
    assert external is None
    assert decided.decided_by_id == owner.id
    assert decided.decided_at is not None


def test_source_owned_request_with_valid_source_remains_actionable(context):
    db, department, _, manager = context
    request = models.Request(title="Aircon parts", department_id=department.id, status="Review")
    db.add(request)
    db.flush()
    approval = models.Approval(
        title="Approve replacement parts",
        source_type="ops_need", source_id=request.id,
        department_id=department.id, status="Pending",
    )
    db.add(approval)
    db.commit()
    decided, linked, _ = decide_approval(db, manager, approval.id, "Approved", "Proceed")
    assert decided.status == "Approved"
    assert linked.id == request.id
    assert linked.status == "Approved"
