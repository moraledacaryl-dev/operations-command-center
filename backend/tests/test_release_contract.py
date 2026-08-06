import unittest

from app.main import app
from app.capabilities import ROLE_CAPABILITIES


class ReleaseContractTests(unittest.TestCase):
    def test_fixed_routes_precede_generic_resource_routes(self):
        paths = [route.path for route in app.routes]
        generic_index = paths.index('/api/{resource}/{item_id}')
        for fixed_path in ('/api/review/queue', '/api/my-work'):
            self.assertIn(fixed_path, paths)
            self.assertLess(paths.index(fixed_path), generic_index)

    def test_review_queue_is_registered_once(self):
        paths = [route.path for route in app.routes]
        self.assertEqual(paths.count('/api/review/queue'), 1)

    def test_manager_cannot_administer_accounts(self):
        manager = ROLE_CAPABILITIES['manager']
        self.assertFalse(manager['manage_accounts'])
        self.assertTrue(manager['make_decisions'])

    def test_lead_remains_department_scoped(self):
        lead = ROLE_CAPABILITIES['lead']
        self.assertTrue(lead['manage_department'])
        self.assertFalse(lead['view_all_operations'])
        self.assertFalse(lead['manage_accounts'])


if __name__ == '__main__':
    unittest.main()
