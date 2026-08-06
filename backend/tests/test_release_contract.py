import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.main import app
from app.capabilities import ROLE_CAPABILITIES
from app.routers.authorization_hotfix import require_capability


class ReleaseContractTests(unittest.TestCase):
    def test_fixed_routes_precede_generic_resource_routes(self):
        paths = [route.path for route in app.routes]
        generic_item_index = paths.index('/api/{resource}/{item_id}')
        generic_list_index = paths.index('/api/{resource}')
        for fixed_path in ('/api/review/queue', '/api/my-work', '/api/workflow/approvals/{approval_id}/decide'):
            self.assertIn(fixed_path, paths)
            self.assertLess(paths.index(fixed_path), generic_item_index)
        self.assertIn('/api/users', paths)
        self.assertLess(paths.index('/api/users'), generic_list_index)

    def test_security_sensitive_routes_are_registered_once(self):
        paths = [route.path for route in app.routes]
        self.assertEqual(paths.count('/api/review/queue'), 1)
        self.assertEqual(paths.count('/api/workflow/approvals/{approval_id}/decide'), 1)
        self.assertEqual(paths.count('/api/users'), 1)

    def test_manager_cannot_administer_accounts_or_read_sensitive_directory(self):
        manager = ROLE_CAPABILITIES['manager']
        self.assertNotIn('manage_accounts', manager)
        self.assertNotIn('view_sensitive_user_metadata', manager)
        self.assertIn('make_decisions', manager)
        with self.assertRaises(HTTPException) as caught:
            require_capability(SimpleNamespace(role='manager'), 'view_sensitive_user_metadata')
        self.assertEqual(caught.exception.status_code, 403)

    def test_lead_cannot_make_managerial_decisions(self):
        lead = ROLE_CAPABILITIES['lead']
        self.assertIn('manage_department', lead)
        self.assertNotIn('make_decisions', lead)
        with self.assertRaises(HTTPException) as caught:
            require_capability(SimpleNamespace(role='lead'), 'make_decisions')
        self.assertEqual(caught.exception.status_code, 403)

    def test_owner_and_manager_decision_boundaries(self):
        require_capability(SimpleNamespace(role='owner'), 'make_decisions')
        require_capability(SimpleNamespace(role='manager'), 'make_decisions')
        require_capability(SimpleNamespace(role='owner'), 'view_sensitive_user_metadata')


if __name__ == '__main__':
    unittest.main()
