"""Operational detail reads batch people rather than querying per comment."""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app import models as m
from app.routers.authorized_crud import get_resource_authorized
from app.routers.operational_meta import operational_meta


def test_task_detail_with_one_hundred_comments_has_bounded_queries():
    engine = create_engine("sqlite:///:memory:")
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    dept = m.Department(name="Operations")
    db.add(dept)
    db.flush()
    owner = m.User(name="Owner", role="owner", department_id=dept.id)
    author = m.User(name="Comment author", role="staff", department_id=dept.id)
    db.add_all([owner, author])
    db.flush()
    task = m.Task(title="Long-running maintenance", department_id=dept.id, assigned_to_id=author.id)
    db.add(task)
    db.flush()
    owner_id, task_id, author_id = owner.id, task.id, author.id
    for index in range(100):
        db.add(m.Comment(parent_type="tasks", parent_id=task.id, author_id=author.id,
                         body=f"Operational update {index}", comment_type="General"))
    db.add(m.ActivityLog(entity_type="tasks", entity_id=task.id, action="updated", actor_id=author.id))
    db.commit()
    db.expunge_all()
    current = db.get(m.User, owner_id)
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(engine, "before_cursor_execute", capture)
    try:
        result = get_resource_authorized("tasks", task_id, user=current, db=db)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
        db.close()
        engine.dispose()
    assert len(result["comments"]) == 100
    assert all(c["author_name"] == "Comment author" and c["author_id"] == author_id for c in result["comments"])
    assert result["assigned_to_name"] == "Comment author"
    assert result["activity"][0]["actor_name"] == "Comment author"
    assert len(statements) <= 6, f"Detail read performed {len(statements)} SQL queries"


def test_team_metadata_batches_memberships_and_preserves_department_privacy():
    engine = create_engine("sqlite:///:memory:")
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    front, other = m.Department(name="Front"), m.Department(name="Other")
    db.add_all([front, other]); db.flush()
    viewer = m.User(name="Lead", role="lead", department_id=front.id)
    db.add(viewer); db.flush()
    expected_ids = {viewer.id}
    for index in range(100):
        dept = front if index % 2 else other
        person = m.User(name=f"Colleague {index:03}", role="staff", department_id=dept.id,
                        email=f"private-{index}@example.test", password_hash="sensitive")
        db.add(person); db.flush()
        db.add(m.UserDepartment(user_id=person.id, department_id=dept.id, is_primary=True))
        if dept == front: expected_ids.add(person.id)
    db.commit()
    statements = []
    _ = viewer.id, viewer.role, viewer.department_id
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(engine, "before_cursor_execute", capture)
    try:
        result = operational_meta(user=viewer, db=db)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
        db.close(); engine.dispose()
    assert {row["id"] for row in result["users"]} == expected_ids
    assert all("email" not in row and "password_hash" not in row for row in result["users"])
    assert all(row["primary_department_id"] == front.id for row in result["users"])
    assert len(result["departments"]) == 1
    assert len(statements) <= 4, f"Metadata read performed {len(statements)} SQL queries"
