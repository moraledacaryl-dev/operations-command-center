import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.authorization_policy import Action, authorize_action, scope_query
from app.capabilities import has_capability
from app.routers.privacy import users as sensitive_users


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


def seed(db):
    front = models.Department(name="Front Desk")
    marketing = models.Department(name="Marketing")
    db.add_all([front, marketing])
    db.flush()

    roles = {}
    for role in ("owner", "admin", "manager", "lead", "supervisor", "staff"):
        user = models.User(
            name=role.title(),
            email=f"{role}@example.com",
            role=role,
            department_id=front.id,
            is_active=True,
        )
        db.add(user)
        db.flush()
        roles[role] = user
        db.add(models.UserDepartment(user_id=user.id, department_id=front.id, is_primary=True))

    other = models.User(
        name="Other Lead",
        email="other@example.com",
        role="lead",
        department_id=marketing.id,
        is_active=True,
    )
    db.add(other)
    db.flush()
    db.add(models.UserDepartment(user_id=other.id, department_id=marketing.id, is_primary=True))
    db.commit()
    return front, marketing, roles, other


def denied(status, callback):
    with pytest.raises(HTTPException) as exc:
        callback()
    assert exc.value.status_code == status


def test_final_role_capability_matrix_is_explicit():
    assert has_capability("owner", "view_sensitive_user_metadata")
    assert has_capability("admin", "view_sensitive_user_metadata")
    assert has_capability("manager", "make_decisions")
    assert not has_capability("manager", "view_sensitive_user_metadata")
    assert has_capability("lead", "manage_department")
    assert has_capability("supervisor", "manage_department")
    assert not has_capability("lead", "make_decisions")
    assert not has_capability("supervisor", "make_decisions")
    assert not has_capability("staff", "manage_department")


def test_manager_cannot_read_sensitive_user_directory(db):
    _, _, roles, _ = seed(db)
    denied(403, lambda: sensitive_users(active=True, q=None, limit=100, user=roles["manager"], db=db))

    assert sensitive_users(active=True, q=None, limit=100, user=roles["owner"], db=db)
    assert sensitive_users(active=True, q=None, limit=100, user=roles["admin"], db=db)


def test_lead_and_supervisor_manage_only_their_department_and_cannot_decide(db):
    front, marketing, roles, _ = seed(db)
    own = models.Task(title="Own", department_id=front.id)
    other = models.Task(title="Other", department_id=marketing.id)
    approval = models.Approval(title="Decision", department_id=front.id, status="Pending")
    db.add_all([own, other, approval])
    db.commit()

    for role in ("lead", "supervisor"):
        user = roles[role]
        authorize_action(db, user, "tasks", Action.EDIT, obj=own)
        denied(403, lambda user=user: authorize_action(db, user, "tasks", Action.EDIT, obj=other))
        denied(403, lambda user=user: authorize_action(db, user, "approvals", Action.DECIDE, obj=approval))


def test_staff_has_scoped_reads_but_no_implicit_department_writes(db):
    front, marketing, roles, _ = seed(db)
    own = models.Task(title="Own", department_id=front.id)
    other = models.Task(title="Other", department_id=marketing.id)
    db.add_all([own, other])
    db.commit()

    staff = roles["staff"]
    rows = scope_query(db, staff, models.Task, db.query(models.Task).order_by(models.Task.id)).all()
    assert [row.title for row in rows] == ["Own"]
    denied(403, lambda: authorize_action(db, staff, "tasks", Action.CREATE, department_id=front.id))
    denied(403, lambda: authorize_action(db, staff, "tasks", Action.EDIT, obj=own))


def test_owner_admin_global_mutation_and_manager_decision_are_deliberate(db):
    front, marketing, roles, _ = seed(db)
    cross_department_task = models.Task(title="Marketing", department_id=marketing.id)
    approval = models.Approval(title="Pending", department_id=front.id, status="Pending")
    db.add_all([cross_department_task, approval])
    db.commit()

    authorize_action(db, roles["owner"], "tasks", Action.EDIT, obj=cross_department_task)
    authorize_action(db, roles["admin"], "tasks", Action.EDIT, obj=cross_department_task)
    authorize_action(db, roles["manager"], "approvals", Action.DECIDE, obj=approval)
