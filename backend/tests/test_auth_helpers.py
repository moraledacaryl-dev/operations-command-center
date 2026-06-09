import unittest

from app.auth import hash_password, password_strength_warnings, verify_password


class AuthHelperTests(unittest.TestCase):
    def test_hash_and_verify_password(self):
        hashed = hash_password("VeryStrongPass!2026")
        self.assertNotEqual(hashed, "VeryStrongPass!2026")
        self.assertTrue(verify_password("VeryStrongPass!2026", hashed))
        self.assertFalse(verify_password("wrong-pass", hashed))

    def test_password_strength_rules(self):
        self.assertTrue(password_strength_warnings("short"))
        self.assertFalse(password_strength_warnings("VeryStrongPass!2026"))


if __name__ == "__main__":
    unittest.main()
