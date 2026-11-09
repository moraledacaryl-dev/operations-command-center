from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.routers.api import AdminUserCreatePayload, LoginPayload
from app.routers.privacy import create_user, login


def test_username_creation_and_login_keep_email_accounts_working():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    models.Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        department = models.Department(name='Café')
        owner = models.User(name='Test owner', email='owner@example.test', role='owner', is_active=True)
        db.add_all([department, owner]); db.commit()
        password = 'Practice-Only-4938!'
        for identity in ('ann.clarin', 'staff@example.test'):
            result = create_user(AdminUserCreatePayload(name='Test employee', email=identity,
                role='staff', department_id=department.id, password=password), user=owner, db=db)
            assert result.email == identity
            assert login(LoginPayload(email=identity.upper(), password=password), db=db)['id'] == result.id
        with pytest.raises(HTTPException) as duplicate:
            create_user(AdminUserCreatePayload(name='Another', email='ANN.CLARIN',
                role='staff', department_id=department.id, password=password), user=owner, db=db)
        assert duplicate.value.status_code == 400
    engine.dispose()
