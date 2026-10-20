"""History keyset pagination must not lose archived records after page one."""

from datetime import timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.clock import utc_now
from app.routers.api import history_search


def _page(db, user, *, cursor=None, kind=None, q=None, limit=3):
    return history_search(
        q=q,
        kind=kind,
        department_id=None,
        limit=limit,
        cursor=cursor,
        user=user,
        db=db,
    )


def test_history_pagination_does_not_skip_records_past_per_resource_limit():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        department = models.Department(name="Operations")
        db.add(department)
        db.flush()
        owner = models.User(
            name="Owner", email="history-owner@example.com",
            role="owner", department_id=department.id, is_active=True,
        )
        db.add(owner)
        db.flush()

        instant = utc_now()
        # Many items at exactly the same timestamp exercise resource/id
        # tie-breaking; older items exercise a later timestamp boundary.
        for index in range(9):
            db.add(models.Task(
                title=f"Task {index}", department_id=department.id,
                hidden_from_active=True, updated_at=instant,
            ))
        for index in range(5):
            db.add(models.Project(
                title=f"Project {index}", department_id=department.id,
                hidden_from_active=True, updated_at=instant,
            ))
        for index in range(4):
            db.add(models.Task(
                title=f"Older {index}", department_id=department.id,
                hidden_from_active=True, updated_at=instant - timedelta(days=index + 1),
            ))
        db.commit()

        expected = [
            (kind, row.id)
            for kind, model in [("tasks", models.Task), ("projects", models.Project)]
            for row in db.query(model).filter(model.hidden_from_active.is_(True)).all()
        ]
        # The same (timestamp, type, ID) global sort as the production API.
        expected.sort(
            key=lambda key: (
                db.get(models.Task if key[0] == "tasks" else models.Project, key[1]).updated_at,
                key[0],
                key[1],
            ),
            reverse=True,
        )

        seen = []
        cursor = None
        for page_number in range(12):
            page = _page(db, owner, cursor=cursor, limit=3)
            seen.extend((item["kind"], item["id"]) for item in page["items"])
            if not page["has_more"]:
                assert page["next_cursor"] is None
                break
            assert page["next_cursor"] and page["next_cursor"] != cursor
            cursor = page["next_cursor"]
        else:
            raise AssertionError("History pagination did not terminate")

        assert seen == expected
        assert len(seen) == len(set(seen)) == 18
    finally:
        db.close()
        engine.dispose()


def test_history_pagination_applies_search_and_department_scope_on_all_pages():
    engine = create_engine("sqlite:///:memory:")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        first = models.Department(name="Front Desk")
        second = models.Department(name="Accounting")
        db.add_all([first, second])
        db.flush()
        staff = models.User(
            name="Receptionist", email="history-staff@example.com",
            role="staff", department_id=first.id, is_active=True,
        )
        db.add(staff)
        db.flush()
        instant = utc_now()
        for index in range(8):
            db.add(models.Task(
                title=f"Needle {index}",
                department_id=first.id,
                hidden_from_active=True,
                updated_at=instant - timedelta(minutes=index),
            ))
        db.add(models.Task(
            title="Needle from another department",
            department_id=second.id, hidden_from_active=True, updated_at=instant,
        ))
        db.add(models.Task(
            title="Unrelated front desk record",
            department_id=first.id, hidden_from_active=True, updated_at=instant,
        ))
        db.commit()

        titles = []
        cursor = None
        while True:
            page = _page(db, staff, cursor=cursor, kind="tasks", q="Needle", limit=2)
            titles.extend(item["title"] for item in page["items"])
            if not page["has_more"]:
                break
            assert page["next_cursor"] != cursor
            cursor = page["next_cursor"]

        assert titles == [f"Needle {index}" for index in range(8)]
    finally:
        db.close()
        engine.dispose()
