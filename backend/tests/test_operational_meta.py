from types import SimpleNamespace
from unittest.mock import patch

from app.user_dto import DepartmentMembershipResponse, operational_user


def test_operational_user_summary_excludes_sensitive_account_fields():
    candidate = SimpleNamespace(
        id=7,
        name='Test Technician',
        role='staff',
        department_id=3,
        email='secret@example.com',
        password_hash='never expose',
        password_set_at='sensitive',
        last_login_at='sensitive',
    )
    departments = [DepartmentMembershipResponse(id=3, name='Maintenance', is_primary=True, role_override=None)]
    with patch('app.user_dto.department_memberships', return_value=departments):
        payload = operational_user(None, candidate).model_dump(mode='json')

    assert payload['id'] == 7
    assert payload['name'] == 'Test Technician'
    assert payload['primary_department_id'] == 3
    assert 'email' not in payload
    assert 'password_hash' not in payload
    assert 'password_set_at' not in payload
    assert 'last_login_at' not in payload
