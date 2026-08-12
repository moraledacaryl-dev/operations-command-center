from types import SimpleNamespace
from unittest.mock import patch

from app.routers.operational_meta import operational_user_summary


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
    departments = [{'id': 3, 'name': 'Maintenance', 'short_name': 'Maint', 'is_primary': True, 'role_override': None}]
    with patch('app.routers.operational_meta.user_departments', return_value=departments):
        payload = operational_user_summary(None, candidate)

    assert payload['id'] == 7
    assert payload['name'] == 'Test Technician'
    assert payload['primary_department_id'] == 3
    assert 'email' not in payload
    assert 'password_hash' not in payload
    assert 'password_set_at' not in payload
    assert 'last_login_at' not in payload
