import unittest

from app.main import app


class RouteOrderingTests(unittest.TestCase):
    def test_review_queue_is_registered_before_generic_item_route(self):
        paths = [getattr(route, "path", None) for route in app.routes]
        review_index = paths.index("/api/review/queue")
        generic_index = paths.index("/api/{resource}/{item_id}")

        self.assertLess(
            review_index,
            generic_index,
            "/api/review/queue must be registered before the generic resource item route",
        )

    def test_review_queue_is_registered_once_by_fixed_router(self):
        matching = [route for route in app.routes if getattr(route, "path", None) == "/api/review/queue"]

        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0].endpoint.__module__, "app.routers.review")


if __name__ == "__main__":
    unittest.main()
