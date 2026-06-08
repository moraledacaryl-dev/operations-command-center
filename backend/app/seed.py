from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from . import models


def seed_if_empty(db: Session):
    if db.query(models.Department).count() > 0:
        return

    departments = [
        "Management", "Front Desk", "Housekeeping", "Café", "Kitchen", "Maintenance", "Marketing", "Admin", "Security"
    ]
    dept_map = {}
    for name in departments:
        dept = models.Department(name=name, short_name=name[:4].upper())
        db.add(dept)
        db.flush()
        dept_map[name] = dept

    caryl = models.User(name="Caryl", email="caryl@example.com", role="owner", department_id=dept_map["Management"].id)
    manager = models.User(name="Manager", email="manager@example.com", role="manager", department_id=dept_map["Management"].id)
    marketing = models.User(name="Marketing Lead", email="marketing@example.com", role="lead", department_id=dept_map["Marketing"].id)
    maintenance = models.User(name="Maintenance", email="fix@example.com", role="lead", department_id=dept_map["Maintenance"].id)
    frontdesk = models.User(name="Front Desk Lead", email="frontdesk@example.com", role="lead", department_id=dept_map["Front Desk"].id)
    cafelead = models.User(name="Café Lead", email="cafe@example.com", role="lead", department_id=dept_map["Café"].id)
    db.add_all([caryl, manager, marketing, maintenance, frontdesk, cafelead])
    db.flush()

    def member(user, dept_name, primary=False, role_override=None):
        db.add(models.UserDepartment(user_id=user.id, department_id=dept_map[dept_name].id, is_primary=primary, role_override=role_override))

    # Person-based login, department-scoped workspaces. One person may belong to several departments.
    for dept_name in departments:
        member(caryl, dept_name, primary=(dept_name == "Management"))
    for dept_name in ["Management", "Front Desk", "Housekeeping", "Café", "Kitchen", "Maintenance", "Marketing", "Admin", "Security"]:
        member(manager, dept_name, primary=(dept_name == "Management"))
    member(marketing, "Marketing", primary=True)
    member(marketing, "Café")
    member(maintenance, "Maintenance", primary=True)
    member(maintenance, "Housekeeping")
    member(frontdesk, "Front Desk", primary=True)
    member(frontdesk, "Housekeeping")
    member(cafelead, "Café", primary=True)
    member(cafelead, "Kitchen")

    rooms = ["Room 201", "Room 202", "Room 203", "Room 204", "Room 205", "Lobby", "Café", "Kitchen", "Pool", "Function Hall", "Garden", "Storage"]
    room_map = {}
    for name in rooms:
        kind = "room" if name.startswith("Room") else "area"
        item = models.RoomArea(name=name, kind=kind)
        db.add(item)
        db.flush()
        room_map[name] = item

    project = models.Project(
        title="June Marketing Plan",
        department_id=dept_map["Marketing"].id,
        owner_id=marketing.id,
        status="Active",
        priority="Normal",
        due_date=datetime.utcnow() + timedelta(days=21),
        note="Low-word campaign plan for rooms, café, pool, and event bookings.",
    )
    db.add(project)
    db.flush()

    db.add_all([
        models.Task(title="Review weekend promos", department_id=dept_map["Marketing"].id, assigned_to_id=caryl.id, project_id=project.id, due_date=datetime.utcnow() + timedelta(days=1), status="Review", priority="Normal"),
        models.Task(title="Verify pool towels", department_id=dept_map["Housekeeping"].id, assigned_to_id=manager.id, due_date=datetime.utcnow(), status="To Do", priority="Normal"),
        models.Task(title="Check Room 205 AC", department_id=dept_map["Maintenance"].id, assigned_to_id=maintenance.id, due_date=datetime.utcnow(), status="Doing", priority="Urgent"),
        models.ShiftNote(title="Room 205 AC weak", shift="Night", category="Room", department_id=dept_map["Front Desk"].id, urgency="Urgent", status="New", note="Guest said cooling was weak. Monitor next shift."),
        models.ShiftNote(title="Pool towels low", shift="PM", category="Supply", department_id=dept_map["Housekeeping"].id, urgency="Normal", status="Follow", note="Check laundry before morning shift."),
        models.GuestNote(title="Late checkout", department_id=dept_map["Front Desk"].id, room_area_id=room_map["Room 203"].id, issue_type="Checkout", urgency="Normal", status="Open", note="Guest requested late checkout. Needs approval."),
        models.Fix(title="Room 205 AC", department_id=dept_map["Maintenance"].id, room_area_id=room_map["Room 205"].id, problem="Weak cooling reported by guest.", urgency="Urgent", status="Working", assigned_to_id=maintenance.id),
        models.Post(title="Burger Reel", department_id=dept_map["Marketing"].id, platform="TikTok", content_type="Reel", post_date=datetime.utcnow() + timedelta(days=2), assigned_to_id=marketing.id, project_id=project.id, status="Review", caption="Hook: Two burgers, one craving. Hidden Oasis café weekend feature.", campaign="June Café Push"),
        models.Post(title="Pool Staycation Story", department_id=dept_map["Marketing"].id, platform="Instagram", content_type="Story", post_date=datetime.utcnow() + timedelta(days=1), assigned_to_id=marketing.id, project_id=project.id, status="Draft", campaign="Weekend Staycation"),
        models.Approval(title="Late checkout Room 203", source_type="guest", source_id=1, requested_by_id=manager.id, department_id=dept_map["Front Desk"].id, status="Pending", priority="Normal", note="Guest requested extension."),
        models.Memo(title="Function Hall", department_id=dept_map["Front Desk"].id, message="Event setup 2 PM.", expiry_date=datetime.utcnow() + timedelta(days=1), must_ack=True),
    ])

    # Department requests/proposals, lightweight docs/talk, and recurring routine templates.
    db.add_all([
        models.Request(title="Extra blender", department_id=dept_map["Café"].id, requested_by_id=cafelead.id, request_type="Equipment", urgency="Normal", status="Review", reason="Peak drinks slow down when one blender is occupied.", note="If approved, link to official Accounting PR."),
        models.Request(title="Late checkout rule", department_id=dept_map["Front Desk"].id, requested_by_id=frontdesk.id, request_type="Policy", urgency="Normal", status="Draft", reason="Staff need clearer limits before asking management."),
        models.TalkMessage(parent_type="department", parent_id=dept_map["Café"].id, department_id=dept_map["Café"].id, author_id=cafelead.id, message_type="Ask", body="Can we review weekend drink prep before the next promo?"),
        models.TalkMessage(parent_type="department", parent_id=dept_map["Housekeeping"].id, department_id=dept_map["Housekeeping"].id, author_id=manager.id, message_type="Decision", body="Pool towel checks stay daily until laundry stabilizes."),
        models.DepartmentDoc(title="Guest complaint handling", department_id=dept_map["Front Desk"].id, doc_type="SOP", body="Listen, log under Guests, assign follow-up, and escalate urgent concerns."),
        models.DepartmentDoc(title="Café opening guide", department_id=dept_map["Café"].id, doc_type="Checklist", body="Counter, cash float, machine check, prep check, menu availability."),
        models.RoutineTemplate(title="Weekly café inventory count", department_id=dept_map["Café"].id, assigned_to_id=cafelead.id, frequency="Weekly", priority="Normal", checklist="Count dry goods\nCount dairy\nCount drinks\nNote low stock\nLink Accounting PR only if buying is approved"),
        models.RoutineTemplate(title="General cleaning check", department_id=dept_map["Housekeeping"].id, assigned_to_id=manager.id, frequency="Weekly", priority="Normal", checklist="Rooms\nBathrooms\nPool area\nLinen storage\nLost and found"),
        models.RoutineTemplate(title="Marketing review", department_id=dept_map["Marketing"].id, assigned_to_id=marketing.id, frequency="Weekly", priority="Normal", checklist="Check review posts\nCheck scheduled posts\nRecord final URLs\nArchive posted content"),
    ])
    db.commit()

    post = db.query(models.Post).filter(models.Post.title == "Burger Reel").first()
    if post:
        db.add(models.PostVersion(post_id=post.id, version_no=1, filename="burger-reel-v1.mp4", file_url="/uploads/burger-reel-v1.mp4", caption_snapshot=post.caption, note="First cut for review.", uploaded_by_id=marketing.id, is_current=True))
        db.commit()
