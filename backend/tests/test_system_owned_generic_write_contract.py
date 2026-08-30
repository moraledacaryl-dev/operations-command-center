import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.routers.authorized_crud import create_resource_authorized


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


def owner(db):
    department = models.Department(name="Final Recert", short_name="FRC")
    user = models.User(
        name="Owner",
        email="owner-final-recert@example.invalid",
        role="owner",
        department_id=None,
        is_active=True,
    )
    db.add_all([department, user])
    db.commit()
    return user


@pytest.mark.parametrize("resource", ["approvals", "submissions", "external-review-items"])
def test_system_owned_generic_create_returns_405_before_payload_validation(db, resource):
    user = owner(db)

    with pytest.raises(HTTPException) as exc:
        create_resource_authorized(resource, {}, user, db)

    assert exc.value.status_code == 405
    assert exc.value.detail == "Use the canonical workflow endpoint."
