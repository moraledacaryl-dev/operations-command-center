"""Fill ONLY the isolated /tmp Operations UI preview with fictional sample data.
Run from the repository: backend/.venv/bin/python scripts/seed_ui_preview.py
Repeatable: matches demo titles/emails and does not touch the production seed.
"""
import os
import sys
from pathlib import Path
from datetime import timedelta

PREVIEW_DB = Path('/tmp/operations-ui-redesign.db')
if not PREVIEW_DB.is_file():
    raise SystemExit('Start and migrate the isolated UI preview database first.')
os.environ['DATABASE_URL'] = f'sqlite:///{PREVIEW_DB}'
os.environ['ENVIRONMENT'] = 'local'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.database import SessionLocal
from app import models as m
from app.clock import utc_now

now = utc_now()
db = SessionLocal()
departments = {d.name: d for d in db.query(m.Department).all()}
owner = db.query(m.User).filter_by(email='caryl@example.com').one()


def put(model, match, **fields):
    item = db.query(model).filter_by(**match).first()
    if not item:
        item = model(**match)
        db.add(item)
    for key, value in fields.items():
        setattr(item, key, value)
    db.flush()
    return item

# Fictional colleagues and a practical set of work for each team.
teams = {
    'Management': ('Mara Santos', 'Weekend readiness', ['Confirm weekend staffing', 'Review pool safety recommendations', 'Approve the guest welcome refresh', 'Walk through the property with team leads', 'Review weekly service feedback']),
    'Front Desk': ('Isabel Cruz', 'A warmer guest arrival', ['Confirm Saturday group arrival', 'Prepare Room 203 late checkout', 'Review airport transfer schedule', 'Update welcome cards for returning guests', 'Check next-day room allocations']),
    'Housekeeping': ('Lea Ramos', 'Guest room refresh', ['Prepare Room 201 for early arrival', 'Complete linen quality check', 'Inspect the pool towel station', 'Deep clean second-floor corridors', 'Restock guest amenities']),
    'Café': ('Nico Reyes', 'Weekend café service', ['Check the espresso grinder calibration', 'Prepare cold brew for the weekend', 'Review the new seasonal menu', 'Set up the garden coffee station', 'Count takeaway cups and lids']),
    'Kitchen': ('Paolo Flores', 'Breakfast service refresh', ['Confirm breakfast prep quantities', 'Check cold storage temperature log', 'Test the updated breakfast plating', 'Prepare event menu tasting', 'Review allergen labels']),
    'Maintenance': ('Marco Dela Cruz', 'Preventive care programme', ['Restore cooling in Room 205', 'Check pool pump pressure', 'Review the garden lighting repair', 'Service second-floor air conditioners', 'Inspect function hall power outlets']),
    'Marketing': ('Ava Garcia', 'October at the Oasis', ['Prepare weekend staycation campaign', 'Review café reel final cut', 'Approve the poolside photo selection', 'Schedule October event highlights', 'Update room amenity descriptions']),
    'Admin': ('Sofia Lim', 'A smoother back office', ['Confirm delivery schedule with suppliers', 'Review monthly supply requests', 'File updated vendor documents', 'Organise staff uniform distribution', 'Update the shared contact directory']),
    'Security': ('Luis Mendoza', 'Safe and welcoming spaces', ['Inspect garden pathway lighting', 'Review event parking arrangements', 'Confirm evening patrol coverage', 'Test the emergency radio handsets', 'Update visitor access log']),
}
for name, (lead_name, project_title, task_titles) in teams.items():
    dept = departments[name]
    email = f'preview.{dept.id}@example.com'
    lead = put(m.User, {'email': email}, name=lead_name, role='lead', department_id=dept.id, is_active=True)
    put(m.UserDepartment, {'user_id': lead.id, 'department_id': dept.id}, is_primary=True)
    colleague = put(m.User, {'email': f'preview.team.{dept.id}@example.com'}, name=['Ella Torres', 'Ben Castillo', 'Jessa Navarro', 'Andre Tan', 'Mia Santos', 'Rafael Cruz', 'Bea Lim', 'Carlo Reyes', 'Dani Flores'][dept.id-1], role='staff', department_id=dept.id, is_active=True)
    put(m.UserDepartment, {'user_id': colleague.id, 'department_id': dept.id}, is_primary=True)
    project = put(m.Project, {'title': project_title, 'department_id': dept.id}, owner_id=lead.id, status='Active', priority='Normal', start_date=now-timedelta(days=4), due_date=now+timedelta(days=12), note=f'{lead_name} is coordinating the team checklist, quality review and final handover. First review on Friday; complete before the next busy weekend.')
    for i, title in enumerate(task_titles):
        task = put(m.Task, {'title': title, 'department_id': dept.id}, assigned_to_id=owner.id if i in (0,2) else lead.id if i in (1,3) else colleague.id, owner_id=lead.id, project_id=project.id, status=['Doing', 'To Do', 'Review', 'Doing', 'Done'][i], priority=['Urgent','Normal','Normal','Normal','Low'][i], due_date=now+timedelta(days=[-1,0,1,3,-2][i]), note=[f'Coordinate with {lead_name} before the afternoon handover. Confirm the work is complete and add the result for the next shift.', 'Complete the checklist, record anything that needs follow-up, and flag missing supplies before 3 PM.', 'Work is ready for a final check. Review the details and confirm any changes with the team.', 'Planned for the quieter afternoon window. Keep guest-facing areas clear and post a progress update.', 'Completed during the morning shift. Final checks recorded and the team has been updated.'][i])
        put(m.Comment, {'parent_type':'tasks', 'parent_id':task.id, 'body':'Morning update: the team has checked the details and confirmed the next steps.'}, author_id=lead.id)
        put(m.ActivityLog, {'entity_type':'tasks', 'entity_id':task.id, 'action':'created'}, actor_id=lead.id, message=f'{lead_name} added {title}', created_at=now-timedelta(hours=i+1))
    for i, title in enumerate(['Afternoon handover — priorities confirmed', 'Weekend preparation — follow-up needed']):
        put(m.ShiftNote, {'title': title, 'department_id':dept.id}, shift=['AM','PM'][i], category='Operations', submitted_by_id=lead.id, urgency=['Normal','Urgent'][i], status=['New','Follow'][i], note=[f'{task_titles[0]} is underway. {lead_name} will check progress at 2 PM. Supplies are ready and the team has the updated checklist.', f'Please follow up on: {task_titles[1].lower()}. Leave a short update before closing the shift; coordinate with the next team if anything remains open.'][i])
    request = put(m.Request, {'title': f'{name} — weekend supplies', 'department_id':dept.id}, requested_by_id=lead.id, assigned_to_id=owner.id, request_type='Supplies', urgency='Normal', status='Review', reason='Replenish the items on the team checklist ahead of the weekend. Quantities were checked against current stock.', note='Team lead has reviewed the list. Awaiting management decision before procurement.')
    put(m.Request, {'title': f'{name} — checklist update', 'department_id':dept.id}, requested_by_id=lead.id, request_type='Improvement', urgency='Normal', status='Planned', reason='Use one shared checklist for the morning and evening teams so outstanding work is easy to hand over.')
    put(m.Approval, {'title':f'Review {name.lower()} supply request', 'department_id':dept.id}, requested_by_id=lead.id, source_type='requests', source_id=request.id, status='Pending', priority='Normal', note='The team has checked available stock. Please review the replenishment request for the weekend.')
    for title, frequency in [('Opening checks', 'Daily'), ('Weekly quality walkthrough', 'Weekly')]:
        put(m.RoutineTemplate, {'title':f'{name} · {title}', 'department_id':dept.id}, assigned_to_id=lead.id, frequency=frequency, status='Active', priority='Normal', checklist='Check the work area\nReview outstanding items\nConfirm supplies and equipment\nAssign follow-up owners\nRecord the handover')
    for title, body in [('Team handover guide', 'Start with unfinished work. Include the location, current status, next action and the person responsible. Urgent guest matters should be raised directly with the duty manager.'), ('Service quality checklist', 'Keep guest areas clean and ready. Confirm equipment is working, supplies are stocked, and every open item has a named owner. Record the outcome before ending the shift.')]:
        put(m.DepartmentDoc, {'title':f'{name} · {title}', 'department_id':dept.id}, doc_type='SOP', body=body, status='Active')
    for i, body in enumerate([f'Today’s focus: {task_titles[0].lower()}. Please add your updates before the afternoon handover.', 'Weekend checklist is ready. Flag any supply gaps by 3 PM so we can coordinate with Admin.']):
        put(m.TalkMessage, {'department_id':dept.id, 'body':body}, parent_type='department', parent_id=dept.id, author_id=lead.id if i==0 else colleague.id, message_type=['Update','Ask'][i], status='Open')
    put(m.Memo, {'title':f'{name} weekend briefing', 'department_id':dept.id}, message='Team huddle at 2 PM. Bring your open items and confirm handover coverage for the weekend.', expiry_date=now+timedelta(days=3), must_ack=True)

room_notes = {
    'Room 201':'Garden-facing room · Queen bed · Near the main staircase. Check welcome amenities before each arrival.',
    'Room 202':'Twin room · Two single beds · Quiet garden side. Spare linen is available in the second-floor cabinet.',
    'Room 203':'Family room · Queen bed and daybed · Pool view. Confirm requested checkout time with Front Desk.',
    'Room 204':'Deluxe room · King bed · Private balcony. Include balcony furniture in the daily readiness check.',
    'Room 205':'Deluxe room · Queen bed · Garden view. Cooling performance is being monitored by Maintenance.',
    'Room 206':'Twin room · Two single beds · Courtyard view. Prepare extra drinking water for the incoming group.',
    'Room 207':'Family room · Two queen beds · Second floor. Keep the extra amenity basket ready for family arrivals.',
    'Room 208':'Deluxe room · King bed · Pool view. Inspect blackout curtains and bedside lighting during turnover.',
    'Lobby':'Guest arrivals, welcome seating and concierge desk. Keep the entry clear and refresh the welcome display each morning.',
    'Café':'Indoor seating and garden tables. Coffee service, light meals and weekend specials; coordinate setup with the café lead.',
    'Kitchen':'Breakfast, café and event preparation. Daily checks cover refrigeration, hygiene, equipment and closing procedures.',
    'Pool':'Guest pool and sun terrace. Monitor water quality, towel levels and pathway safety throughout the day.',
    'Function Hall':'Flexible event space with AV and banquet setup. Confirm the seating plan and power requirements before each event.',
    'Garden':'Outdoor seating, landscaped paths and evening lighting. Walk the grounds before opening and after sunset.',
    'Storage':'Linen, amenities and operating supplies. Keep labelled shelves clear and record low-stock items at each handover.',
}
maintenance_id = departments['Maintenance'].id
front_id = departments['Front Desk'].id
tech = db.query(m.User).filter_by(email=f'preview.{maintenance_id}@example.com').one()
for i, (name, note) in enumerate(room_notes.items()):
    room = put(m.RoomArea, {'name':name}, kind='room' if name.startswith('Room') else 'area', status='active', note=note)
    problem = ['Bedside reading lamp flickers', 'Door latch needs adjustment', 'Bathroom tap drips after closing', 'Balcony light needs replacement', 'Air conditioner cooling is weak', 'Shower pressure needs checking', 'Curtain rail needs securing', 'Remote control battery replacement'][i%8] if room.kind=='room' else {'Lobby':'Entry light flickers', 'Café':'Coffee counter outlet needs inspection', 'Kitchen':'Extractor fan vibration', 'Pool':'Pool pump pressure check', 'Function Hall':'Projector cable connection loose', 'Garden':'Pathway light needs replacement', 'Storage':'Shelf bracket needs securing'}[name]
    put(m.Fix, {'title':f'{name} · {problem}', 'room_area_id':room.id}, department_id=maintenance_id, problem=problem+'. Reported during the morning property walkthrough.', assigned_to_id=tech.id, reported_by_id=owner.id, urgency='Urgent' if i in (4,11) else 'Normal', status=['Open','Working','Done','Verified'][i%4], note='Parts checked and the work area is accessible. Coordinate timing with Front Desk to minimise guest disruption.')
    if room.kind=='room':
        put(m.GuestNote, {'title':f'{name} · Arrival preferences', 'room_area_id':room.id}, department_id=front_id, guest_name=['Alex Rivera','Sam Chen','Jamie Torres','Taylor Cruz','Morgan Lee','Riley Santos','Casey Lim','Jordan Reyes'][i], issue_type='Request', urgency='Normal', status='Open' if i%3 else 'Done', assigned_to_id=owner.id, follow_up_date=now+timedelta(hours=i+1), note=['Extra pillows and a quiet setup requested. Confirm everything is in place before the 2 PM arrival.', 'Guest requested additional drinking water and fresh towels after the afternoon swim.', 'Please confirm late checkout availability and update Housekeeping before noon.'][i%3], action_taken='Front Desk acknowledged the request and informed the responsible team.')

for i, title in enumerate(['Slow mornings at Hidden Oasis', 'A weekend by the pool', 'Behind the café counter', 'Your next family staycation', 'Garden evenings, made for you']):
    put(m.Post, {'title':title, 'department_id':departments['Marketing'].id}, platform=['Instagram','Facebook','TikTok','Instagram','Facebook'][i], content_type=['Reel','Static','Reel','Carousel','Story'][i], post_date=now+timedelta(days=i), assigned_to_id=db.query(m.User).filter_by(email=f"preview.{departments['Marketing'].id}@example.com").one().id, campaign='October at the Oasis', status=['Review','Draft','Set','Idea','Fix'][i], caption='A little space to slow down. Discover garden mornings, poolside afternoons and warm hospitality at Hidden Oasis.', note='Keep the opening frame simple and make the booking details easy to read.')
# Calendar and inbox samples exercise the newer workspace surfaces too.
from app.foundation_models import MarketingCampaign, ContentConcept, PlatformDeliverable, Notification
campaign = put(MarketingCampaign, {'name':'October moments', 'department_id':departments['Marketing'].id}, objective='Show the quieter moments, warm service and weekend experiences at Hidden Oasis.', status='Active', owner_id=owner.id, start_at=now-timedelta(days=7), end_at=now+timedelta(days=14))
for i, title in enumerate(['A garden breakfast', 'Poolside weekend plans', 'Meet the café team', 'Your room, ready for you']):
    concept = put(ContentConcept, {'campaign_id':campaign.id, 'title':title}, content_pillar=['Food','Staycation','People','Rooms'][i], brief='Use warm natural light, simple framing and a short caption. End with a clear invitation to book or visit.', status='Active', owner_id=owner.id)
    for j, platform in enumerate(['Instagram','Facebook']):
        put(PlatformDeliverable, {'concept_id':concept.id, 'platform':platform}, format='Reel' if i%2 else 'Static', caption='Slow down and enjoy a little time at Hidden Oasis.', status=['Draft','Review','Approved','Scheduled'][i], assigned_to_id=owner.id, scheduled_at=(now+timedelta(days=i*2+j)).replace(hour=1, minute=0, second=0))
for i, (title, body, url) in enumerate([
    ('A café reel is ready for review', 'Ava has finished the latest cut. Review the caption and opening frame before scheduling.', '/posts'),
    ('Your project has a new update', 'The weekend checklist has been reviewed. Confirm the final priorities with the team.', '/projects'),
    ('Room 205 cooling needs follow-up', 'Maintenance has inspected the unit and logged the next action for the afternoon shift.', '/fixes'),
    ('Supply request waiting for a decision', 'The café team has checked available stock and submitted its weekend request.', '/approvals'),
]):
    put(Notification, {'user_id':owner.id, 'title':title}, kind='Update', body=body, action_url=url, priority='Normal', read_at=now-timedelta(hours=1) if i==3 else None, created_at=now-timedelta(hours=i+1))
db.commit()
print('Local preview filled:', {model.__tablename__:db.query(model).count() for model in [m.RoomArea,m.Task,m.Project,m.Request,m.Fix,m.GuestNote,m.ShiftNote,m.DepartmentDoc,m.RoutineTemplate]})
db.close()
