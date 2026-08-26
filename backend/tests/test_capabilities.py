import unittest

from app.capabilities import capability_payload, has_capability
from app.role_boundary import _required_capability


class CapabilityContractTests(unittest.TestCase):
    def test_manager_cannot_administer_accounts(self):
        self.assertFalse(has_capability("manager", "manage_accounts"))
        self.assertTrue(has_capability("manager", "make_decisions"))
        self.assertTrue(has_capability("manager", "manage_approvals"))
        self.assertTrue(has_capability("manager", "view_integration_summary"))

    def test_owner_and_admin_can_manage_accounts(self):
        self.assertTrue(has_capability("owner", "manage_accounts"))
        self.assertTrue(has_capability("admin", "manage_accounts"))
        self.assertTrue(has_capability("owner", "view_integration_summary"))

    def test_lead_is_department_scoped(self):
        payload = capability_payload("lead")
        self.assertTrue(payload["manage_department"])
        self.assertFalse(payload["view_all_operations"])
        self.assertFalse(payload["manage_accounts"])
        self.assertFalse(payload["view_integration_summary"])

    def test_account_routes_require_account_capability(self):
        self.assertEqual(_required_capability("POST", "/api/admin/users"), "manage_accounts")
        self.assertEqual(_required_capability("PATCH", "/api/users/7"), "manage_accounts")
        self.assertEqual(_required_capability("POST", "/api/departments"), "manage_system")
        self.assertIsNone(_required_capability("GET", "/api/departments"))


if __name__ == "__main__":
    unittest.main()
