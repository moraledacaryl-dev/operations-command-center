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

        areas = [f"Room {n}" for n in (101,102,103,104,105,201,202,203,204,205,301,302)] + [
            "Lobby", "Front Desk", "Café", "Kitchen", "Pool", "Function Hall",
            "Garden", "Storage", "Parking", "Laundry", "Staff Area"]
        rooms = {name: add(models.RoomArea(name=name, kind="room" if name.startswith("Room") else "area",
            status="active", note="Fictional training area — not real property inventory."), "rooms_areas") for name in areas}

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
            "Housekeeping": ["Inspect Room 203","Count linen inventory","Confirm room readiness","Record missing amenities"],
            "Café": ["Prepare counter checklist","Check available menu","Resolve service delay","Close café station"],
            "Kitchen": ["Check cold-storage temperatures","Complete prep list","Review food-handling incident","Close kitchen"],
            "Maintenance": ["Inspect pool pump","Investigate Room 205 AC","Prepare repair evidence","Review defects"],
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

        guest_titles = [
            ("Late checkout request", "Room 203", "Checkout", "Open"),
            ("Room 205 AC not cooling", "Room 205", "Room", "Follow"),
            ("Pool access complaint", "Pool", "Complaint", "Open"),
            ("Breakfast service delay", "Café", "Food", "Follow"),
            ("Lost room key", "Lobby", "Other", "Open"),
            ("Noise concern", "Room 201", "Complaint", "Done"),
            ("Function hall layout issue", "Function Hall", "Other", "Open"),
            ("More towels requested", "Room 101", "Request", "Follow"),
            ("Water pressure concern", "Room 302", "Room", "Open"),
            ("Room cleaning follow-up", "Room 204", "Room", "Open"),
            ("Pool towel shortage", "Pool", "Request", "Follow"),
            ("Parking access question", "Parking", "Complaint", "Done"),
            ("Check-in documentation", "Front Desk", "Request", "Open"),
            ("Allergy question", "Kitchen", "Food", "Open"),
            ("Late room checkout dispute", "Room 202", "Checkout", "Open"),
        ]
        guests = []
        for i,(title,area,kind,status) in enumerate(guest_titles):
            g=add(models.GuestNote(title=PREFIX+title, guest_name=f"Demo Guest {i+1:02d}",
                department_id=departments["Café" if kind=="Food" else "Front Desk"].id,
                room_area_id=rooms[area].id, issue_type=kind,
                assigned_to_id=users["frontdesk-lead"].id,
                urgency="Urgent" if i in (1,8) else "Normal", status=status,
                follow_up_date=now+timedelta(hours=3+i),
                note="TRAINING ONLY — fictional guest concern."), "guest_notes")
            guests.append(g)
        fix_areas = ["Room 205","Pool","Room 302","Café","Kitchen","Function Hall",
            "Room 201","Garden","Lobby","Laundry","Parking","Storage"]
        fixes=[]
        for i,area in enumerate(fix_areas):
            status=["Working","Open","Done","Working","Open","Done","Verified"][i%7]
            linked=guests[1] if i==0 else guests[8] if i==2 else None
            fix=add(models.Fix(title=PREFIX+f"{area}: simulated maintenance issue",
                department_id=departments["Maintenance"].id, room_area_id=rooms[area].id,
                problem="Fictional repair scenario for practical training.",
                status=status, urgency="Urgent" if i in (0,2) else "Normal",
                assigned_to_id=users["maintenance-lead"].id,
                linked_guest_note_id=linked.id if linked else None,
                verified_by_id=users["manager"].id if status=="Verified" else None,
                verified_at=now if status=="Verified" else None), "fixes")
            if linked: linked.linked_fix_id=fix.id
            fixes.append(fix)

        for dept in DEPARTMENTS:
            for i,status in enumerate(["New","Seen","Follow","Done"]):
                add(models.ShiftNote(title=PREFIX+f"{dept} {'AM PM Night PM'.split()[i]} handover #{i+1}",
                    shift=["AM","PM","Night","PM"][i], category="Other",
                    department_id=departments[dept].id, submitted_by_id=users[PRIMARY_WORKER[dept]].id,
                    urgency="Urgent" if i==2 else "Normal", status=status,
                    note="TRAINING ONLY — record responsible person and pending follow-up."), "shift_notes")
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
        for i in range(12):
            u=users[PEOPLE[(i+3)%len(PEOPLE)][2]]
            add(fm.Notification(user_id=u.id,kind="training",
                title=PREFIX+f"Notification exercise #{i+1}",
                body="Fictional notification only.",source_type="tasks",
                source_id=str(all_tasks[i].id),action_url="/tasks"),"notifications")

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
    return dict(counts)

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
