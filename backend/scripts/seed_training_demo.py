#!/usr/bin/env python3
"""Guarded synthetic seed for a NEW, migrated local-only Operations training DB.

No production or staging database can be used. No external integrations run.
The script never erases, truncates, or updates existing business records.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import stat

DATASET_VERSION = "2026-10-26.2"
PREFIX = "[TRAINING] "
ACK = "ISOLATED_TRAINING_DATABASE_ONLY"

PEOPLE = [
    ("Demo Elena Santos", "owner", "owner", "Management"),
    ("Demo Rafael Rivera", "admin", "administrator", "Admin"),
    ("Demo Maya Tan", "manager", "manager", "Management"),
    ("Demo Ana Reyes", "supervisor", "frontdesk-lead", "Front Desk"),
    ("Demo Bea Navarro", "lead", "housekeeping-lead", "Housekeeping"),
    ("Demo Carlo Flores", "lead", "cafe-lead", "Café"),
    ("Demo Dana Cruz", "supervisor", "kitchen-lead", "Kitchen"),
    ("Demo Emil Ramos", "lead", "maintenance-lead", "Maintenance"),
    ("Demo Faye Lopez", "lead", "marketing-lead", "Marketing"),
    ("Demo Gio Torres", "supervisor", "security-lead", "Security"),
    ("Demo Isabel Lim", "staff", "reception-am", "Front Desk"),
    ("Demo Jonas Sy", "staff", "reception-pm", "Front Desk"),
    ("Demo Kaye Dizon", "staff", "housekeeper-am", "Housekeeping"),
    ("Demo Luca Garcia", "staff", "housekeeper-pm", "Housekeeping"),
    ("Demo Mika Ong", "staff", "barista-am", "Café"),
    ("Demo Nico Yu", "staff", "barista-pm", "Café"),
    ("Demo Pia Chua", "staff", "cook", "Kitchen"),
    ("Demo Quinn Lee", "staff", "technician", "Maintenance"),
    ("Demo Rosa Perez", "staff", "marketing-assistant", "Marketing"),
    ("Demo Sam Villanueva", "staff", "guard", "Security"),
]
DEPARTMENTS = ["Management", "Front Desk", "Housekeeping", "Café", "Kitchen", "Maintenance", "Marketing", "Admin", "Security"]
PRIMARY_WORKER = {
    "Management": "manager", "Front Desk": "reception-am",
    "Housekeeping": "housekeeper-am", "Café": "barista-am",
    "Kitchen": "cook", "Maintenance": "technician",
    "Marketing": "marketing-assistant", "Admin": "administrator",
    "Security": "guard",
}
LEADS = {
    "Front Desk": "frontdesk-lead", "Housekeeping": "housekeeping-lead",
    "Café": "cafe-lead", "Kitchen": "kitchen-lead",
    "Maintenance": "maintenance-lead", "Marketing": "marketing-lead",
    "Security": "security-lead", "Management": "manager", "Admin": "administrator",
}

# Short, role-relevant repair reports for reading practice.
REPAIR_EXAMPLES = {
    "Solace": ("Air conditioner blowing warm air", "The guest says the air conditioner is blowing warm air. Check the unit and tell Front Desk what you find."),
    "Pool": ("Pool pump making a loud noise", "The pool pump is making an unusual noise. A qualified person needs to inspect the pump."),
    "Crown": ("Low water pressure", "The bathroom tap has low water pressure. Check the supply and report what you find."),
    "Café": ("Coffee station light is out", "The light above the coffee station is not working. A qualified person needs to check it."),
    "Kitchen": ("Cold room temperature check", "The cold room is warmer than expected. Tell the Kitchen lead and arrange a qualified check."),
    "Function Hall": ("Door latch sticking", "The function hall door latch sticks when the door closes. Inspect the latch and report the result."),
    "Perch 1": ("Bathroom tap dripping", "The bathroom tap keeps dripping after it is turned off. Inspect the tap and report the result."),
    "Garden": ("Garden light is out", "A garden pathway light is not working. Ask a qualified person to inspect it."),
    "Lobby": ("Lobby fan making noise", "The lobby fan makes a rattling sound when running. Inspect the fan and report the result."),
    "Laundry": ("Laundry machine vibrating", "A laundry machine vibrates more than usual. Ask the Laundry lead when it can be inspected."),
    "Parking": ("Parking light is out", "The parking area light is not working. Ask a qualified person to inspect it."),
    "Storage": ("Storage door handle loose", "The storage door handle is loose. Inspect the handle and report the result."),
}

def guard() -> Path:
    if os.environ.get("ENVIRONMENT", "").strip().lower() not in {"local", "test"}:
        raise SystemExit("REFUSED: ENVIRONMENT must explicitly be local/test")
    if os.environ.get("ALLOW_DEMO_SEED", "").strip().lower() != "false":
        raise SystemExit("REFUSED: ALLOW_DEMO_SEED must explicitly be false")
    if os.environ.get("ALLOW_DEFAULT_ADMIN_BOOTSTRAP", "false").lower() != "false":
        raise SystemExit("REFUSED: default admin bootstrap is not permitted")
    url = os.environ.get("DATABASE_URL", "")
    # Windows SQLAlchemy uses sqlite:///C:/absolute/path, while POSIX uses
    # sqlite:////absolute/path. Require native absolute paths on both platforms.
    prefix = "sqlite:///" if os.name == "nt" else "sqlite:////"
    if not url.startswith(prefix) or "?" in url or "#" in url:
        raise SystemExit("REFUSED: only an absolute training SQLite URL is allowed")
    path = Path(url[len("sqlite:///"):])
    if not path.is_absolute() or not path.name.startswith("operations_training_demo_") or path.suffix != ".sqlite":
        raise SystemExit("REFUSED: expected operations_training_demo_*.sqlite")
    if path.is_symlink() or any(part.is_symlink() for part in path.parents):
        raise SystemExit("REFUSED: database path contains a symlink")
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit("REFUSED: migrate a new training database before seeding")
    return path

def seed(db_path: Path, private_dir: Path) -> dict[str, int]:
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sqlalchemy import inspect, text
    from app import models, foundation_models as fm
    from app.database import engine, SessionLocal
    from app.auth import hash_password

    if private_dir.exists() and any(private_dir.iterdir()):
        raise SystemExit("REFUSED: private credentials destination must be new or empty")
    if private_dir == db_path.parent or db_path.is_relative_to(private_dir):
        raise SystemExit("REFUSED: credentials cannot be stored alongside the database")
    inspector = inspect(engine)
    tables = sorted(inspector.get_table_names())
    must_have = {"alembic_version", "users", "departments", "tasks", "guest_notes", "fixes",
                 "marketing_campaigns", "inbox_items", "project_purchase_items"}
    if not must_have.issubset(tables):
        raise SystemExit("REFUSED: training schema missing migrations")
    with engine.connect() as conn:
        if not conn.execute(text("SELECT version_num FROM alembic_version")).first():
            raise SystemExit("REFUSED: migration revision is missing")
        # Fail closed for every user/business table, not only a hand-selected subset.
        used = [table for table in tables if table not in {"alembic_version", "sqlite_sequence"}
                and conn.execute(text('SELECT EXISTS(SELECT 1 FROM "'+table+'" LIMIT 1)')).scalar()]
        if used:
            raise SystemExit("REFUSED: database already contains records: " + ", ".join(used))

    now = datetime.now(timezone.utc)
    counts: Counter[str] = Counter()
    credentials: list[dict[str, str]] = []
    private_dir.mkdir(parents=True, exist_ok=True)
    private_dir.chmod(0o700)
    with SessionLocal() as db:
        def add(row, label: str):
            db.add(row); db.flush(); counts[label] += 1
            return row

        departments = {name: add(models.Department(name=name, short_name=name[:4].upper()), "departments") for name in DEPARTMENTS}
        users = {}
        for name, role, slug, primary in PEOPLE:
            password = secrets.token_urlsafe(18) + "Aa1!"
            u = add(models.User(name=name, email=slug+"@training.invalid",
                role=role, department_id=departments[primary].id, is_active=True,
                password_hash=hash_password(password), password_set_at=now), "users")
            users[slug] = u
            memberships = list(DEPARTMENTS) if role in {"owner", "manager"} else [primary]
            if slug == "administrator": memberships = ["Admin", "Management"]
            if slug == "frontdesk-lead": memberships.append("Housekeeping")
            if slug == "marketing-lead": memberships.append("Café")
            for dept in memberships:
                add(models.UserDepartment(user_id=u.id, department_id=departments[dept].id,
                    is_primary=dept == primary), "memberships")
            credentials.append({"name": name, "role": role, "email": u.email, "password": password, "department": primary})

        room_names = ["Solace", "Cafe Suite", "Perch 1", "Perch 2", "Crown", "Grandeur", "Skyroom", "Twinspire"]
        areas = room_names + [
            "Lobby", "Front Desk", "Café", "Kitchen", "Pool", "Function Hall",
            "Garden", "Storage", "Parking", "Laundry", "Staff Area"]
        rooms = {name: add(models.RoomArea(name=name, kind="room" if name in room_names else "area",
            status="active", note="Practice room name. Guest details and work records are fictional."), "rooms_areas") for name in areas}

        projects = {}
        for i, dept in enumerate(["Front Desk", "Housekeeping", "Café", "Kitchen", "Maintenance", "Marketing", "Management", "Security"]):
            name = ["Guest Experience Practice", "Room Readiness Practice", "Café Service Improvements",
                "Food Safety Rehearsal", "Room AC Maintenance Cycle", "Halloween Campaign Simulation",
                "Function Hall Training Event", "Pool Access Procedure"][i]
            projects[dept] = add(models.Project(
                title=PREFIX+name, department_id=departments[dept].id,
                owner_id=users[LEADS[dept]].id, status=["Active","Active","Planned","Active","Active","Active","Planned","Paused"][i],
                priority="High" if i%3==0 else "Normal", due_date=now+timedelta(days=8+i),
                note="TRAINING ONLY — collaboration and controlled workflow rehearsal."), "projects")

        descriptions = {
            "Front Desk": ["Review arrivals","Confirm check-out notes","Update pending guest requests","Escalate complaint"],
            "Housekeeping": ["Inspect Perch 2","Count linen inventory","Confirm room readiness","Record missing amenities"],
            "Café": ["Prepare counter checklist","Check available menu","Resolve service delay","Close café station"],
            "Kitchen": ["Check cold-storage temperatures","Complete prep list","Review food-handling incident","Close kitchen"],
            "Maintenance": ["Inspect pool pump","Investigate Solace AC","Prepare repair evidence","Review defects"],
            "Marketing": ["Draft promotional post","Review campaign caption","Submit artwork","Confirm scheduled content"],
            "Security": ["Inspect pool gate","Complete perimeter check","Review reported incident","Log visitor handover"],
            "Management": ["Review approvals","Allocate priorities","Review handover","Check department reports"],
            "Admin": ["Review demo accounts","Audit memberships","Check notifications","Review access records"],
        }
        all_tasks: list[models.Task] = []
        for dept, titles in descriptions.items():
            for i, title in enumerate(titles+["Follow up overdue item","Inspect handover exception"]):
                task=add(models.Task(
                    title=PREFIX+title, department_id=departments[dept].id,
                    assigned_to_id=users[PRIMARY_WORKER[dept]].id,
                    owner_id=users[LEADS[dept]].id,
                    project_id=projects[dept].id if dept in projects else None,
                    status=["To Do","Doing","Review","Done","To Do","To Do"][i],
                    priority="Urgent" if i==4 else ("High" if i==2 else "Normal"),
                    due_date=now+timedelta(days=(-3 if i==4 else i-1)),
                    note="TRAINING ONLY — do not confuse with actual assigned work."), "tasks")
                all_tasks.append(task)
        for dept in ("Front Desk","Housekeeping","Maintenance","Marketing"):
            add(models.Task(title=PREFIX+f"Archived {dept} example",
                department_id=departments[dept].id, assigned_to_id=users[PRIMARY_WORKER[dept]].id,
                status="Done", hidden_from_active=True, archive_reason="Training sample",
                completed_at=now-timedelta(days=3), archived_at=now-timedelta(days=2)), "tasks")

        # Every fictional login needs work to read during orientation, including
        # supervisors and PM accounts, not only the primary department worker.
        for _, role, slug, dept in PEOPLE:
            if slug == PRIMARY_WORKER[dept]:
                continue
            for i, (status, days) in enumerate([("To Do", -1), ("Doing", 0), ("Review", 1)]):
                add(models.Task(title=PREFIX+descriptions[dept][i]+" — assigned practice",
                    department_id=departments[dept].id, assigned_to_id=users[slug].id,
                    owner_id=users[LEADS[dept]].id, status=status,
                    priority="High" if i == 0 else "Normal", due_date=now+timedelta(days=days),
                    note="TRAINING ONLY — read the instructions and saved status. "
                         "For this made-up job, tell your lead what is still needed. "
                         "Waiting means another team has not confirmed its part; Review means the lead must check the work."), "tasks")

        guest_titles = [
            ("Late checkout request", "Perch 2", "Checkout", "Open"),
            ("Solace AC not cooling", "Solace", "Room", "Follow"),
            ("Pool access complaint", "Pool", "Complaint", "Open"),
            ("Breakfast service delay", "Café", "Food", "Follow"),
            ("Lost room key", "Lobby", "Other", "Open"),
            ("Noise concern", "Perch 1", "Complaint", "Done"),
            ("Function hall layout issue", "Function Hall", "Other", "Open"),
            ("More towels requested", "Grandeur", "Request", "Follow"),
            ("Water pressure concern", "Crown", "Room", "Open"),
            ("Room cleaning follow-up", "Twinspire", "Room", "Open"),
            ("Pool towel shortage", "Pool", "Request", "Follow"),
            ("Parking access question", "Parking", "Complaint", "Done"),
            ("Check-in documentation", "Front Desk", "Request", "Open"),
            ("Allergy question", "Kitchen", "Food", "Open"),
            ("Late room checkout dispute", "Skyroom", "Checkout", "Open"),
            ("Perch 1 towel request", "Perch 1", "Request", "Open"),
        ]
        guests = []
        for i,(title,area,kind,status) in enumerate(guest_titles):
            g=add(models.GuestNote(title=PREFIX+title, guest_name=f"Demo Guest {i+1:02d}",
                department_id=departments["Café" if kind=="Food" else "Front Desk"].id,
                room_area_id=rooms[area].id, issue_type=kind,
                assigned_to_id=users["frontdesk-lead"].id,
                urgency="Urgent" if i in (1,8) else "Normal", status=status,
                follow_up_date=now+timedelta(hours=3+i),
                note=("TRAINING ONLY — the air conditioner is not cooling. Maintenance must check it; Front Desk must update the guest." if area == "Solace" else
                      "TRAINING ONLY — the guest requested extra towels. Housekeeping has not confirmed delivery." if title == "Perch 1 towel request" else
                      "TRAINING ONLY — fictional guest concern.")), "guest_notes")
            guests.append(g)
        fix_areas = ["Solace","Pool","Crown","Café","Kitchen","Function Hall",
            "Perch 1","Garden","Lobby","Laundry","Parking","Storage"]
        fixes=[]
        for i,area in enumerate(fix_areas):
            status=["Working","Open","Done","Working","Open","Done","Verified"][i%7]
            linked=guests[1] if i==0 else guests[8] if i==2 else None
            fix=add(models.Fix(title=PREFIX+f"{area}: {REPAIR_EXAMPLES[area][0]}",
                department_id=departments["Maintenance"].id, room_area_id=rooms[area].id,
                problem=REPAIR_EXAMPLES[area][1],
                status=status, urgency="Urgent" if i in (0,2) else "Normal",
                assigned_to_id=users["maintenance-lead"].id,
                linked_guest_note_id=linked.id if linked else None,
                verified_by_id=users["manager"].id if status=="Verified" else None,
                verified_at=now if status=="Verified" else None), "fixes")
            if linked: linked.linked_fix_id=fix.id
            fixes.append(fix)

        handover_topics = {
            "Front Desk": ("Solace AC is still warm", "Perch 1 needs two extra towels", "Maintenance", "Housekeeping"),
            "Housekeeping": ("Twinspire bathroom still needs inspection", "Grandeur linen count is short by two towels", "Housekeeping", "Laundry"),
            "Café": ("A breakfast order is delayed at table 3", "The coffee station is waiting for clean cups", "Kitchen", "Café"),
            "Kitchen": ("Cold-storage temperature needs a qualified check", "The allergy order needs ingredient confirmation", "Maintenance", "Kitchen"),
            "Maintenance": ("Solace AC inspection is unfinished", "The pool pump inspection needs a part", "Maintenance", "Maintenance"),
            "Marketing": ("The weekend caption still needs the lead's review", "The draft photo needs the correct room name", "Marketing", "Marketing"),
            "Security": ("The pool gate latch has not been checked", "The parking visitor log needs a handover check", "Maintenance", "Security"),
            "Management": ("A department request is waiting for evidence", "A repair needs an authorized final check", "Management", "Maintenance"),
            "Admin": ("A practice account access question is unresolved", "The department roster needs the lead's confirmation", "Admin", "Admin"),
        }
        for dept in DEPARTMENTS:
            night, afternoon, night_team, pm_team = handover_topics[dept]
            for i,status in enumerate(["New","Seen","Follow","Done"]):
                topic, team = (night, night_team) if i == 2 else (afternoon, pm_team)
                handover_note = (
                    "TRAINING ONLY — " + topic + ". "
                    + ("Keep affected food out of service and alert the Kitchen lead now. " if dept == "Kitchen" and status != "Done" else
                       "Keep guests away from the unchecked gate and alert the Security lead now. " if dept == "Security" and i == 2 else "")
                    + ("The previous shift confirmed the check was completed. No follow-up remains." if status == "Done" else
                       "The work is not confirmed complete. " + users[LEADS[dept]].name +
                       " is responsible for contacting " + team + ". The incoming shift should check with the lead "
                       "within 30 minutes and record the update. Do not tell the guest or next team it is finished without confirmation.")
                )
                add(models.ShiftNote(title=PREFIX+f"{dept} {'AM PM Night PM'.split()[i]} handover #{i+1}",
                    shift=["AM","PM","Night","PM"][i], category="Other",
                    department_id=departments[dept].id, submitted_by_id=users[PRIMARY_WORKER[dept]].id,
                    urgency="Urgent" if i==2 else "Normal", status=status,
                    note=handover_note), "shift_notes")
            for i in range(3):
                add(models.Request(title=PREFIX+f"{dept} operational request #{i+1}",
                    department_id=departments[dept].id, requested_by_id=users[LEADS[dept]].id,
                    request_type=["Equipment","Policy","General"][i], status=["Draft","Review","Approved"][i],
                    urgency="Normal", reason="Fictional operations proposal for staff training.",
                    note="TRAINING ONLY — Accounting procurement is separate."), "requests")
            add(models.Memo(title=PREFIX+f"{dept} training briefing",department_id=departments[dept].id,
                message="Training record. Practise checking and acknowledging the daily briefing.",
                must_ack=True,expiry_date=now+timedelta(days=20)), "memos")
            add(models.DepartmentDoc(title=PREFIX+f"{dept} simulated SOP",
                department_id=departments[dept].id, doc_type="SOP",
                body="TRAINING ONLY. Check assigned work, record exceptions, escalate, hand over."), "department_docs")
            for freq in ("Daily","Weekly"):
                add(models.RoutineTemplate(title=PREFIX+f"{dept} {freq.lower()} practice routine",
                    department_id=departments[dept].id, assigned_to_id=users[PRIMARY_WORKER[dept]].id,
                    frequency=freq, priority="Normal",
                    checklist="Check previous shift\nInspect work queue\nReport outstanding matters\nConfirm next owner"),"routine_templates")
            for i in range(2):
                add(models.TalkMessage(parent_type="department",parent_id=departments[dept].id,
                    department_id=departments[dept].id,author_id=users[LEADS[dept]].id,
                    message_type="Update" if i==0 else "Ask",
                    body=f"TRAINING ONLY — {dept} discussion example #{i+1}."), "talk_messages")
            add(models.Submission(title=PREFIX+f"{dept} shift submission",
                source_app="training_demo",source_type="staff_note",department_id=departments[dept].id,
                submitted_by_id=users[PRIMARY_WORKER[dept]].id,requires_review=True,
                review_status="New",payload_json=json.dumps({"training_only":True})),"submissions")
            add(fm.InboxItem(source_app="training_demo",source_type="exercise",
                source_id=f"exercise-{dept.lower().replace(' ','-')}",event_key="training",
                title=PREFIX+f"{dept} simulated inbox event",
                summary="Synthetic event; no external application is connected.",
                category="Operational",department_id=departments[dept].id,
                assigned_to_id=users[PRIMARY_WORKER[dept]].id,
                payload_json=json.dumps({"training_only":True})),"inbox_items")

        for i in range(12):
            add(models.Approval(title=PREFIX+f"Review exercise {i+1}",
                requested_by_id=users["frontdesk-lead"].id,
                department_id=departments[DEPARTMENTS[i%len(DEPARTMENTS)]].id,
                source_type="guest",source_id=guests[i%len(guests)].id,
                status=["Pending","Approved","Rejected"][i%3],
                priority="Normal",note="TRAINING ONLY — no actual authorization."),"approvals")
        for i in range(14):
            add(models.Post(title=PREFIX+f"Marketing content #{i+1}",
                department_id=departments["Marketing"].id,
                platform=["Instagram","Facebook","TikTok"][i%3],
                content_type=["Reel","Static","Story"][i%3],
                assigned_to_id=users["marketing-assistant"].id,
                project_id=projects["Marketing"].id,
                status=["Idea","Draft","Review","Fix","OK","Set","Posted"][i%7],
                post_date=now+timedelta(days=i),caption="TRAINING ONLY — fictional post, not approved for publishing.",
                campaign="Simulated Staycation Campaign"),"posts")
        for i in range(4):
            campaign=add(fm.MarketingCampaign(department_id=departments["Marketing"].id,
                name=PREFIX+f"Simulated campaign #{i+1}",
                objective="TRAINING ONLY — practice planning content.",
                status="Planning" if i==0 else "Active",
                owner_id=users["marketing-lead"].id,
                start_at=now,end_at=now+timedelta(days=30)),"marketing_campaigns")
            concept=add(fm.ContentConcept(campaign_id=campaign.id,
                content_pillar="Rooms",title=PREFIX+f"Training creative #{i+1}",
                brief="Fictional concept.",status="Idea",
                owner_id=users["marketing-assistant"].id),"content_concepts")
            add(fm.PlatformDeliverable(concept_id=concept.id, platform=["Instagram","Facebook","TikTok","Google Business"][i],
                format="Static",caption="TRAINING ONLY.",status="Planned",
                assigned_to_id=users["marketing-assistant"].id,
                scheduled_at=now+timedelta(days=i+1)),"platform_deliverables")
        for i,project in enumerate(list(projects.values())[:5]):
            add(models.ProjectBudget(project_id=project.id,limit_cents=1800000,
                version=1,updated_by_id=users["manager"].id),"project_budgets")
        for i in range(20):
            project=list(projects.values())[i%len(projects)]
            status=["Suggested","Planned","Purchased","Declined"][i%4]
            amount=(i+1)*12500
            add(models.ProjectPurchaseItem(project_id=project.id,
                name=PREFIX+f"Fictional event supply #{i+1}",
                quantity=i%4+1,unit_price_cents=amount,
                actual_total_cents=amount*(i%4+1) if status=="Purchased" else None,
                category="Other",status=status,note="SIMULATION. Not an actual expense.",
                proposed_by_id=users["manager"].id,updated_by_id=users["manager"].id),
                "project_purchase_items")
        # User-scoped notices must be readable by their recipient. The former
        # sample linked arbitrary user accounts to tasks in other departments;
        # the real visibility guard correctly hid most of them.
        for _, _, slug, _ in PEOPLE:
            for ordinal in (1, 2):
                add(fm.Notification(
                    user_id=users[slug].id, kind="training_practice_read",
                    title=f"{PREFIX}Daily notice practice {ordinal}/2",
                    body="Fictional shift notice. Read the notice, then mark it read using your own Operations account.",
                    source_type=None, source_id=None, action_url=None,
                    priority="Normal",
                ), "notifications")

        counts.update(add_shift_challenge_records(db, now))

        private_file=private_dir/"PRIVATE_training_accounts.json"
        manifest_file=private_dir/"training_manifest.json"
        roster_fd=os.open(private_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(roster_fd,"w",encoding="utf-8") as stream:
            json.dump({"synthetic":True,"accounts":credentials},stream,indent=2)
        manifest_fd=os.open(manifest_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(manifest_fd,"w",encoding="utf-8") as stream:
            json.dump({"dataset_version":DATASET_VERSION,"synthetic":True,
                       "generated_at":now.isoformat(),"counts":dict(counts)},stream,indent=2)
        db.commit()
    ensure_private_trainer_guide(private_dir)
    return dict(counts)


def add_shift_challenge_records(db, now=None) -> Counter:
    """Append practice jobs, handovers and personal notices; never reset work."""
    from app import models, foundation_models as fm
    now = now or datetime.now(timezone.utc)
    cases = json.loads(Path(__file__).with_name("shift_challenge_cases.json").read_text(encoding="utf-8"))
    counts = Counter()
    for case in cases:
        department = db.query(models.Department).filter_by(name=case["department"]).one_or_none()
        if not department:
            continue
        staff = db.query(models.User).filter_by(role="staff", department_id=department.id).all()
        staff = [person for person in staff if person.email and person.email.endswith("@training.invalid")]
        if not staff:
            continue
        ref = case["reference"]
        title = PREFIX + ref + " — " + case["title"]
        handover_title = PREFIX + ref + " — shift handover"
        if not db.query(models.ShiftNote.id).filter_by(title=handover_title, department_id=department.id).first():
            db.add(models.ShiftNote(title=handover_title, department_id=department.id,
                submitted_by_id=staff[0].id, shift="Night", category="Other", status="Follow",
                urgency="Urgent" if case["priority"] == "Critical" else "Normal",
                note=case["situation"] + " The check is still pending. Leave the next shift a clear follow-up; do not mark it finished."))
            counts["shift_notes"] += 1
        for person in staff:
            if not db.query(models.Task.id).filter_by(title=title, department_id=department.id, assigned_to_id=person.id).first():
                db.add(models.Task(title=title, department_id=department.id, assigned_to_id=person.id,
                    status="To Do", priority="Urgent" if case["priority"] == "Critical" else "High",
                    due_date=now+timedelta(hours=1), note=case["situation"] + " Read the shift handover, check your notice, and save a follow-up on this job. Keep its current status; no physical work has been confirmed."))
                counts["tasks"] += 1
            notice_title = PREFIX + ref + " — shift notice"
            if not db.query(fm.Notification.id).filter_by(user_id=person.id, kind="Shift notice", title=notice_title).first():
                db.add(fm.Notification(user_id=person.id, kind="Shift notice", title=notice_title,
                    body=case["situation"] + " Your lead needs a follow-up before the next shift takes over.",
                    source_type=None, source_id=None, action_url=None, priority="High"))
                counts["notifications"] += 1
    db.flush()
    return counts


def improve_existing_staff_examples(db) -> int:
    """Refresh only untouched placeholder notes and add missing personal practice jobs.

    Called only after the desktop training database and fictional roster were validated.
    Existing employee edits, statuses, accounts and job records are preserved.
    """
    from app import models
    examples = {
        "Front Desk": "The guest is waiting for an update about the room's hot water.",
        "Housekeeping": "A room still needs an inspection before the next arrival.",
        "Café": "A breakfast order is delayed and the guest needs an update.",
        "Kitchen": "An allergy order is waiting for an ingredient check. Keep it out of service.",
        "Maintenance": "A repair still needs an inspection before the area can be used.",
        "Marketing": "A draft post has the wrong event date and needs the lead's review.",
        "Security": "The pool gate has not been checked. Keep guests away and tell the lead.",
        "Management": "A request is waiting for supporting information.",
        "Admin": "An account access question is waiting for the lead's check.",
    }
    changed = 0
    placeholder = "TRAINING ONLY — record responsible person and pending follow-up."
    for dept, situation in examples.items():
        department = db.query(models.Department).filter_by(name=dept).one_or_none()
        if not department:
            continue
        for shift, number, status in (("Night", 3, "Follow"), ("PM", 2, "Seen")):
            note = db.query(models.ShiftNote).filter_by(
                title=PREFIX + f"{dept} {shift} handover #{number}", department_id=department.id,
                note=placeholder, status=status, seen_by_id=None, seen_at=None,
                linked_task_id=None, linked_guest_note_id=None, linked_fix_id=None,
                hidden_from_active=False).one_or_none()
            if note:
                note.note = "TRAINING ONLY — " + situation + " The check is still pending. Ask the " + dept + " lead to follow up and tell the next shift what happens."
                changed += 1
    # Replace only the original, unmodified placeholder repair reports. A
    # changed status, added comment or attachment, or later edit means the
    # learner's work wins and the old record is left alone.
    maintenance = db.query(models.Department).filter_by(name="Maintenance").one_or_none()
    initial_statuses = ["Working", "Open", "Done", "Working", "Open", "Done", "Verified"]
    if maintenance:
        for index, (area, (title, problem)) in enumerate(REPAIR_EXAMPLES.items()):
            room = db.query(models.RoomArea).filter_by(name=area).one_or_none()
            if not room:
                continue
            fix = db.query(models.Fix).filter_by(
                title=PREFIX + f"{area}: simulated maintenance issue",
                department_id=maintenance.id, room_area_id=room.id,
                problem="Fictional repair scenario for practical training.",
                status=initial_statuses[index % len(initial_statuses)],
                hidden_from_active=False).one_or_none()
            if not fix or abs((fix.updated_at - fix.created_at).total_seconds()) > 2:
                continue
            if (db.query(models.Comment).filter_by(parent_type="fixes", parent_id=fix.id).first()
                    or db.query(models.Attachment).filter_by(parent_type="fixes", parent_id=fix.id).first()):
                continue
            fix.title = PREFIX + f"{area}: {title}"
            fix.problem = problem
            changed += 1
    now = datetime.now(timezone.utc)
    for _, role, slug, dept in PEOPLE:
        if role != "staff" or dept not in examples:
            continue
        user = db.query(models.User).filter_by(email=slug + "@training.invalid").one_or_none()
        department = db.query(models.Department).filter_by(name=dept).one_or_none()
        if not user or not department or user.department_id != department.id:
            continue
        for title, status, days in (("Overdue follow-up — personal practice", "To Do", -1),
                                    ("Waiting for lead review — personal practice", "Review", 1)):
            title = PREFIX + title
            if db.query(models.Task).filter_by(title=title, assigned_to_id=user.id).first():
                continue
            db.add(models.Task(title=title, department_id=department.id, assigned_to_id=user.id,
                status=status, priority="Normal", due_date=now + timedelta(days=days),
                note="TRAINING ONLY — " + examples[dept] + " Ask your lead what still needs checking."))
            changed += 1
    return changed


def ensure_shift_challenge_data(db_path: Path, state: Path) -> int:
    """Add seven role challenges to a validated fictional desktop installation."""
    # Reuse the existing strict path, environment, roster, and synthetic-user
    # checks. It only appends missing named-room records and never resets them.
    ensure_room_practice_data(db_path, state)
    from app.database import SessionLocal
    with SessionLocal() as db:
        counts = add_shift_challenge_records(db)
        improved = improve_existing_staff_examples(db)
        db.commit()
    return sum(counts.values()) + improved


def ensure_private_trainer_guide(private_dir: Path) -> Path:
    """Present the already-private fictional JSON credentials in a readable trainer-only format.

    No credentials enter the frontend bundle, API, logs or source control. The
    guide is an additional private file beside the existing randomized roster.
    Rewriting it on restart preserves login passwords and all practice data.
    """
    roster = private_dir / "PRIVATE_training_accounts.json"
    guide = private_dir / "PRIVATE_TRAINER_ACCOUNTS.txt"
    if private_dir.is_symlink() or roster.is_symlink() or guide.is_symlink():
        raise SystemExit("REFUSED: training credential paths must not be symlinks")
    if not private_dir.is_dir() or not roster.is_file():
        raise SystemExit("REFUSED: private fictional roster is missing")
    obj = json.loads(roster.read_text(encoding="utf-8"))
    accounts = obj.get("accounts") if isinstance(obj, dict) and obj.get("synthetic") is True else None
    if not isinstance(accounts, list) or len(accounts) < len(PEOPLE):
        raise SystemExit("REFUSED: incomplete private fictional trainer roster")
    names = {slug + "@training.invalid" for _, _, slug, _ in PEOPLE}
    rows = []
    for item in accounts:
        if not isinstance(item, dict) or any(
            not isinstance(item.get(field), str) or not item[field].strip()
            for field in ("name", "role", "email", "department", "password")
        ) or not item["email"].endswith("@training.invalid"):
            raise SystemExit("REFUSED: invalid fictional account entry")
        rows.append(item)
    if not names.issubset({item["email"] for item in rows}):
        raise SystemExit("REFUSED: required fictional staff accounts are missing")

    grouped = sorted(rows, key=lambda item: (
        item["department"].casefold(),
        {"owner": 0, "admin": 1, "manager": 2, "supervisor": 3, "lead": 4, "staff": 5}
            .get(item["role"], 6),
        item["name"].casefold(),
    ))
    lines = [
        "HIDDEN OASIS OPERATIONS — FICTIONAL TRAINING ACCOUNTS",
        "TRAINER ONLY. Not for staff distribution or production sign-in.",
        "",
        "Open the desktop app, then sign in at the automatically opened training login.",
        "Share only the designated employee's EMAIL and PASSWORD with that trainee.",
        "The role and department decide which lessons, records and actions are available.",
        "These are random, local-only passwords. Never use real employee credentials.",
        "",
    ]
    current = ""
    for item in grouped:
        if item["department"] != current:
            current = item["department"]
            lines.extend([f"=== {current.upper()} ===", ""])
        lines.extend([
            f"{item['name']}  ({item['role'].title()})",
            f"  Email:     {item['email']}",
            f"  Password:  {item['password']}",
            "",
        ])
    lines.extend(["Keep this file in the trainer's private application-data folder.", ""])
    rendered = "\n".join(lines)
    if guide.is_file() and guide.read_text(encoding="utf-8") == rendered:
        # Windows Notepad may hold the file open. Do not replace it on every
        # restart when the randomized roster has not changed.
        guide.chmod(0o600)
        return guide
    tmp = private_dir / ("." + guide.name + "." + secrets.token_hex(8) + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(rendered)
        if guide.is_symlink():
            raise SystemExit("REFUSED: private trainer guide target changed")
        os.replace(tmp, guide)
        guide.chmod(0o600)
    finally:
        tmp.unlink(missing_ok=True)
    return guide


def ensure_notification_practice_data(db_path: Path, state: Path) -> int:
    """Idempotently add only missing fictional notice drills to an existing training install.

    This runs after the desktop launchers' strict local state/database checks.
    No production DB, other user, arbitrary record, or existing progress is altered.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app import models, foundation_models as fm
    from app.database import SessionLocal

    state = state.resolve()
    if os.environ.get("ENVIRONMENT") != "local" or os.environ.get("ALLOW_DEMO_SEED") != "false":
        raise SystemExit("REFUSED: synthetic notification repairs require isolated local mode")
    if os.environ.get("ALLOW_DEFAULT_ADMIN_BOOTSTRAP") != "false":
        raise SystemExit("REFUSED: default admin bootstrap is not permitted")
    if not db_path.is_file() or db_path.is_symlink() or db_path.resolve().parent != (state / "data").resolve():
        raise SystemExit("REFUSED: notification repair requires this private training database")
    if not db_path.name.startswith("operations_training_demo_") or db_path.suffix != ".sqlite":
        raise SystemExit("REFUSED: unexpected notification repair target")
    marker = state / "data" / ".initialized"
    roster_path = state / "private" / "accounts" / "PRIVATE_training_accounts.json"
    if not marker.is_file() or not roster_path.is_file() or marker.is_symlink() or roster_path.is_symlink():
        raise SystemExit("REFUSED: already-initialized fictional desktop training required")
    roster = json.loads(roster_path.read_text(encoding="utf-8"))
    expected_emails = {slug + "@training.invalid" for _, _, slug, _ in PEOPLE}
    if roster.get("synthetic") is not True or {
        row.get("email") for row in roster.get("accounts", [])
    } != expected_emails:
        raise SystemExit("REFUSED: private fictional accounts manifest did not match")
    inserted = 0
    with SessionLocal() as db:
        # Require a fully synthetic, isolated population rather than relying
        # only on a file name that could be forged.
        all_emails = {row[0] for row in db.query(models.User.email).all()}
        if not expected_emails.issubset(all_emails) or any(
            not isinstance(email, str) or not email.endswith("@training.invalid")
            for email in all_emails
        ):
            raise SystemExit("REFUSED: unexpected user identities in training notification database")
        users = {row.email: row for row in db.query(models.User).all()}
        for email, user in users.items():
            for ordinal in (1, 2):
                title = f"{PREFIX}Daily notice practice {ordinal}/2"
                if db.query(fm.Notification.id).filter(
                    fm.Notification.user_id == user.id,
                    fm.Notification.kind == "training_practice_read",
                    fm.Notification.title == title,
                ).first():
                    continue
                db.add(fm.Notification(
                    user_id=user.id, kind="training_practice_read",
                    title=title,
                    body="Fictional shift notice. Read the notice, then mark it read using your own Operations account.",
                    source_type=None, source_id=None, action_url=None, priority="Normal",
                ))
                inserted += 1
        db.commit()
    return inserted



def ensure_room_practice_data(db_path: Path, state: Path) -> int:
    """Add missing named rooms and two fictional reading exercises, without resets.

    Only an already-initialized, private, synthetic desktop training DB qualifies.
    Never edits or deletes an existing room, guest concern or employee record.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from app import models
    from app.database import SessionLocal

    if os.environ.get("ENVIRONMENT") != "local" or os.environ.get("ALLOW_DEMO_SEED") != "false":
        raise SystemExit("REFUSED: room practice upgrade is local training only")
    if os.environ.get("ALLOW_DEFAULT_ADMIN_BOOTSTRAP") != "false":
        raise SystemExit("REFUSED: default account bootstrap is not permitted")
    state = state.resolve()
    db_path = Path(db_path)
    expected_data = state / "data"
    if (db_path.is_symlink() or any(part.is_symlink() for part in db_path.parents) or
            not db_path.is_file() or
            db_path.parent.resolve() != expected_data.resolve() or
            not db_path.name.startswith("operations_training_demo_") or db_path.suffix != ".sqlite"):
        raise SystemExit("REFUSED: room practice upgrade requires private training SQLite")
    configured = os.environ.get("DATABASE_URL", "")
    if not configured.startswith("sqlite:///") or Path(configured[10:]).resolve() != db_path.resolve():
        raise SystemExit("REFUSED: configured training database differs from room practice target")
    marker = expected_data / ".initialized"
    roster_file = state / "private" / "accounts" / "PRIVATE_training_accounts.json"
    if (not marker.is_file() or marker.is_symlink() or
            not roster_file.is_file() or roster_file.is_symlink()):
        raise SystemExit("REFUSED: existing fictional installation and roster required")
    roster = json.loads(roster_file.read_text(encoding="utf-8"))
    expected_emails = {slug + "@training.invalid" for _, _, slug, _ in PEOPLE}
    actual_roster_emails = {row.get("email") for row in roster.get("accounts", [])}
    if roster.get("synthetic") is not True or actual_roster_emails != expected_emails:
        raise SystemExit("REFUSED: account roster is not the expected fictional dataset")

    inserted = 0
    with SessionLocal() as db:
        installed_emails = {email for (email,) in db.query(models.User.email).all()}
        if not expected_emails.issubset(installed_emails) or any(
            not isinstance(email, str) or not email.endswith("@training.invalid")
            for email in installed_emails
        ):
            raise SystemExit("REFUSED: room practice target has non-fictional employee accounts")
        department = db.query(models.Department).filter_by(name="Front Desk").one_or_none()
        frontdesk = db.query(models.User).filter_by(email="frontdesk-lead@training.invalid").one_or_none()
        if not department or not frontdesk:
            raise SystemExit("REFUSED: fictional Front Desk training accounts missing")
        room_names = ("Solace", "Cafe Suite", "Perch 1", "Perch 2",
                      "Crown", "Grandeur", "Skyroom", "Twinspire")
        rooms = {}
        for name in room_names:
            room = db.query(models.RoomArea).filter_by(name=name).one_or_none()
            if room is not None and room.kind != "room":
                raise SystemExit("REFUSED: existing practice room name belongs to a shared area")
            if room is None:
                room = models.RoomArea(name=name, kind="room", status="active",
                                       note="Practice room name. Guest details and work records are fictional.")
                db.add(room)
                db.flush()
                inserted += 1
            rooms[name] = room
        drills = (
            ("Solace", "Solace AC not cooling", "Room", "Urgent", "Follow",
             "TRAINING ONLY — the AC is not cooling. Maintenance must check it; Front Desk must update the guest."),
            ("Perch 1", "Perch 1 towel request", "Request", "Normal", "Open",
             "TRAINING ONLY — a guest asked for towels. Housekeeping has not confirmed delivery."),
        )
        for room_name, title, issue_type, urgency, status, note in drills:
            title = PREFIX + title
            existing = db.query(models.GuestNote).filter_by(title=title).one_or_none()
            if existing is not None:
                if existing.room_area_id != rooms[room_name].id:
                    raise SystemExit("REFUSED: existing fictional report linked to wrong room")
                continue
            db.add(models.GuestNote(
                title=title, guest_name="Demo Guest " + room_name,
                department_id=department.id, room_area_id=rooms[room_name].id,
                issue_type=issue_type, urgency=urgency, status=status,
                assigned_to_id=frontdesk.id, follow_up_date=datetime.now(timezone.utc) + timedelta(hours=3),
                note=note,
            ))
            inserted += 1
        db.commit()
    return inserted


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--confirm",required=True)
    parser.add_argument("--private-output",required=True)
    args=parser.parse_args()
    if args.confirm != ACK: raise SystemExit("REFUSED: explicit isolated demo acknowledgement is required")
    db_path=guard()
    private=Path(args.private_output).expanduser().resolve()
    if private == db_path.parent or db_path.is_relative_to(private): raise SystemExit("REFUSED: private credentials must use a separate directory")
    counts=seed(db_path,private)
    print("TRAINING DATA READY; no real data or external calls were used.")
    print("Synthetic record counts:",json.dumps(counts,sort_keys=True))

if __name__ == "__main__":
    main()
