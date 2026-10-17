"""Fictional Halloween example; writes only to the isolated UI preview DB."""
import os
import sys
from pathlib import Path
from datetime import timedelta

preview = Path('/tmp/operations-ui-redesign.db')
if not preview.is_file():
    raise SystemExit('Create and migrate the isolated UI preview first.')
os.environ['DATABASE_URL'] = f'sqlite:///{preview}'
os.environ['ENVIRONMENT'] = 'local'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import models as m
from app.database import SessionLocal
from app.clock import utc_now

with SessionLocal() as db:
    department = db.query(m.Department).filter_by(name='Marketing').one()
    if db.query(m.Project).filter_by(title='Halloween at Hidden Oasis', department_id=department.id).first():
        print('Halloween preview already exists; preserving discussion and budget edits.')
        raise SystemExit(0)
    owner = db.query(m.User).filter_by(email='caryl@example.com').one()
    lead = db.query(m.User).filter_by(name='Ava Garcia').one()
    staff = db.query(m.User).filter_by(name='Bea Lim').one()
    now = utc_now()
    event = m.Project(title='Halloween at Hidden Oasis', department_id=department.id, owner_id=lead.id,
        status='Active', priority='Normal', due_date=now.replace(month=10, day=31, hour=9, minute=0),
        note='October 31 · Garden & café · 40 guests. Costume contest, pumpkin decorating and a snack table.')
    db.add(event); db.flush()
    db.add(m.ProjectBudget(project_id=event.id, limit_cents=2000000, updated_by_id=owner.id))
    posts = [
        (staff, 'Suggestion', 'Could we do a pumpkin-decorating table for the kids? Around 12 small pumpkins plus washable paint. I can run the activity.', 6),
        (lead, 'Question', 'Should we book a speaker or use the café sound system? We need music and a microphone for the costume contest.', 4),
        (owner, 'Decision', 'Let’s keep the event within ₱20,000. Use the garden for activities and the café for snacks. Please add quantities and prices to the purchase list.', 2),
    ]
    threads = []
    for author, kind, body, hours in posts:
        post = m.Comment(parent_type='projects', parent_id=event.id, author_id=author.id, comment_type=kind, body=body, created_at=now-timedelta(hours=hours))
        db.add(post); db.flush(); threads.append(post)
    for author, body in [(lead, 'Yes, let’s plan for 12 pumpkins. We already have brushes in storage.'), (owner, 'Add the pumpkins and paint to the list so we can compare the cost.')]:
        db.add(m.Comment(parent_type='projects', parent_id=event.id, reply_to_id=threads[0].id, author_id=author.id, comment_type='Update', body=body, created_at=now-timedelta(hours=3)))
    db.add(m.Comment(parent_type='projects', parent_id=event.id, reply_to_id=threads[1].id, author_id=staff.id, comment_type='Update', body='The café speaker works, but the microphone cuts out. I’ll ask for a rental quote.', created_at=now-timedelta(hours=1)))
    for voter in [owner, lead]:
        db.add(m.ProjectCommentVote(comment_id=threads[0].id, user_id=voter.id))
    rows = [
        ('Small pumpkins', 12, 18000, 'Activities', 'Planned', 'One per child at the decorating table.', threads[0].id, None, staff),
        ('Washable paint sets', 4, 25000, 'Activities', 'Suggested', 'Use brushes already in storage.', threads[0].id, None, staff),
        ('Snack boxes', 40, 12000, 'Food & drinks', 'Planned', 'Sandwich, juice and a small treat. Confirm allergies.', None, None, lead),
        ('Fairy lights', 3, 45000, 'Decorations', 'Purchased', 'Warm white lights for the garden entrance.', None, 125000, lead),
        ('Costume contest prizes', 3, 50000, 'Activities', 'Suggested', 'Best costume, most creative and kids’ choice.', None, None, staff),
        ('Speaker & microphone rental', 1, None, 'Equipment', 'Suggested', 'Waiting for a supplier quote.', threads[1].id, None, lead),
        ('Printed photo backdrop', 1, 250000, 'Decorations', 'Declined', 'Use the garden wall and existing decorations instead.', None, None, owner),
    ]
    for name, qty, price, category, status, note, source, actual, author in rows:
        db.add(m.ProjectPurchaseItem(project_id=event.id, name=name, quantity=qty, unit_price_cents=price,
            category=category, status=status, note=note, source_comment_id=source, actual_total_cents=actual,
            proposed_by_id=author.id, updated_by_id=owner.id))
    for title, status, person in [('Confirm guest count', 'Done', lead), ('Get a microphone rental quote', 'To Do', staff), ('Prepare activity tables', 'To Do', staff), ('Confirm snack menu', 'Doing', lead)]:
        db.add(m.Task(title=title, department_id=department.id, project_id=event.id, assigned_to_id=person.id,
            owner_id=lead.id, status=status, priority='Normal', due_date=event.due_date-timedelta(days=2)))
    db.commit()
    print(f'Halloween preview: http://127.0.0.1:3310/projects/{event.id}')
