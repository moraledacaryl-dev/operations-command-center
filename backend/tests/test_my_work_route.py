import unittest

from app.main import app


class MyWorkRouteTests(unittest.TestCase):
    def test_my_work_is_registered_before_generic_item_route(self):
        paths = [getattr(route, "path", None) for route in app.routes]
        self.assertIn("/api/my-work", paths)
        self.assertLess(paths.index("/api/my-work"), paths.index("/api/{resource}/{item_id}"))

    def test_my_work_is_registered_once(self):
        matches = [route for route in app.routes if getattr(route, "path", None) == "/api/my-work"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].endpoint.__module__, "app.routers.my_work")


if __name__ == "__main__":
    unittest.main()
