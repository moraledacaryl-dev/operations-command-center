import unittest

from app.main import app


class RouteOrderingTests(unittest.TestCase):
    def test_every_method_and_path_pair_is_registered_once(self):
        seen = set()
        duplicates = []
        for route in app.routes:
            for method in getattr(route, "methods", set()):
                key = (method, getattr(route, "path", None))
                if key in seen:
                    duplicates.append(key)
                seen.add(key)
        self.assertEqual(duplicates, [], f"Duplicate route registrations: {duplicates}")

    def test_openapi_operation_ids_are_unique(self):
        operation_ids = [
            operation["operationId"]
            for path in app.openapi()["paths"].values()
            for operation in path.values()
            if isinstance(operation, dict) and "operationId" in operation
        ]
        self.assertEqual(len(operation_ids), len(set(operation_ids)))

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

    def test_health_is_registered_before_generic_collection_route(self):
        paths = [getattr(route, "path", None) for route in app.routes]
        health_index = paths.index("/api/health")
        generic_index = paths.index("/api/{resource}")

        self.assertLess(
            health_index,
            generic_index,
            "/api/health must be registered before the generic resource collection route",
        )


if __name__ == "__main__":
    unittest.main()
