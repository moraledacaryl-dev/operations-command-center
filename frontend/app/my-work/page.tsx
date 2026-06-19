'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { canSupervise, getCurrentDepartmentId, getStoredUser, roleLabel } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

const EMPTY_SHIFT = { title: '', shift: 'AM', category: 'Other', urgency: 'Normal', note: '' };
const EMPTY_REQUEST = { title: '', request_type: 'General', urgency: 'Normal', reason: '' };
const shifts = ['AM', 'PM', 'Night'];
const categories = ['Guest', 'Room', 'Fix', 'Supply', 'Payment', 'Event', 'Staff', 'Other'];
const requestTypes = ['General', 'Equipment', 'Policy', 'Process', 'Staffing', 'Supply', 'Maintenance', 'Event', 'Other'];
const priorities = ['Low', 'Normal', 'Urgent'];

function WorkCard({ item, href, kind, users }: { item: Entity; href: string; kind: string; users?: Entity[] }) {
  const assigned = users?.find(user => Number(user.id) === Number(item.assigned_to_id));
  return (
    <Link className={`card ${item.priority === 'Urgent' || item.urgency === 'Urgent' ? 'card-important' : ''}`} href={href}>
      <div className="card-title">{item.title || item.name || 'Item'}</div>
      <div className="card-line">
        <Pill value={kind} />
        <Pill value={item.status || item.review_status} />
        <Pill value={item.priority || item.urgency} />
        {assigned ? <Pill value={`Assigned: ${assigned.name}`} /> : null}
      </div>
      {item.note || item.reason || item.problem || item.caption ? <span className="muted">{String(item.note || item.reason || item.problem || item.caption).slice(0, 90)}</span> : null}
    </Link>
  );
}

function StatLink({ label, value, href, tone }: { label: string; value: number; href: string; tone?: string }) {
  return <Link className={`stat ${tone || ''}`} href={href}><span className="muted">{label}</span><b>{value}</b></Link>;
}

function openItems(rows: Entity[], doneStatus: string) {
  return rows.filter(item => item.status !== doneStatus && !item.hidden_from_active);
}

function deptNames(user?: Entity | null) {
  return (user?.departments || []).map((department: Entity) => String(department.name || '').toLowerCase());
}

function hasDept(user: Entity | null, names: string[]) {
  const departments = deptNames(user);
  return names.some(name => departments.some(department => department.includes(name)));
}

export default function MyWorkPage() {
  const [user, setUser] = useState<Entity | null>(null);
  const [meta, setMeta] = useState<Entity>({ users: [], departments: [] });
  const [tasks, setTasks] = useState<Entity[]>([]);
  const [teamTasks, setTeamTasks] = useState<Entity[]>([]);
  const [requests, setRequests] = useState<Entity[]>([]);
  const [shiftNotes, setShiftNotes] = useState<Entity[]>([]);
  const [guests, setGuests] = useState<Entity[]>([]);
  const [fixes, setFixes] = useState<Entity[]>([]);
  const [posts, setPosts] = useState<Entity[]>([]);
  const [shiftForm, setShiftForm] = useState<Entity>(EMPTY_SHIFT);
  const [requestForm, setRequestForm] = useState<Entity>(EMPTY_REQUEST);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    const stored = getStoredUser();
    const supervisor = canSupervise(stored);
    setUser(stored);
    const departmentId = getCurrentDepartmentId(stored);
    try {
      const [taskRows, requestRows, shiftRows, metaRows, guestRows, fixRows, postRows] = await Promise.all([
        api.list('tasks', { active: true, department_id: departmentId || '', limit: 80 }),
        api.list('requests', { active: true, department_id: departmentId || '', limit: 40 }),
        api.list('shift-notes', { active: true, department_id: departmentId || '', limit: 35 }),
        api.meta(),
        supervisor ? api.list('guests', { active: true, department_id: departmentId || '', limit: 30 }) : Promise.resolve([]),
        supervisor ? api.list('fixes', { active: true, department_id: departmentId || '', limit: 30 }) : Promise.resolve([]),
        supervisor ? api.list('posts', { active: true, department_id: departmentId || '', limit: 30 }) : Promise.resolve([]),
      ]);
      const assigned = taskRows.filter((task: Entity) => Number(task.assigned_to_id) === Number(stored?.id));
      setMeta(metaRows);
      setTasks((assigned.length ? assigned : taskRows).slice(0, 6));
      setTeamTasks(openItems(taskRows, 'Done').slice(0, 8));
      setRequests(requestRows.slice(0, supervisor ? 6 : 4));
      setShiftNotes(shiftRows.slice(0, supervisor ? 6 : 4));
      setGuests(openItems(guestRows, 'Done').slice(0, 5));
      setFixes(openItems(fixRows, 'Verified').slice(0, 5));
      setPosts(postRows.filter((post: Entity) => !['Posted'].includes(post.status)).slice(0, 5));
    } catch (err: any) {
      setError(err.message || 'Could not load your work.');
    }
  }

  useEffect(() => { load(); }, []);

  function departmentId() {
    return getCurrentDepartmentId(user) || user?.primary_department_id || user?.departments?.[0]?.id || null;
  }

  async function saveShiftNote() {
    if (!String(shiftForm.title || '').trim()) {
      setError('Shift title is required.');
      return;
    }
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await api.create('shift-notes', { ...shiftForm, status: 'New', department_id: departmentId() });
      setShiftForm(EMPTY_SHIFT);
      setSaved('Shift note sent.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not send shift note.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRequest() {
    if (!String(requestForm.title || '').trim()) {
      setError('Request title is required.');
      return;
    }
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await api.create('requests', { ...requestForm, status: 'Review', department_id: departmentId() });
      setRequestForm(EMPTY_REQUEST);
      setSaved('Request sent.');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not send request.');
    } finally {
      setBusy(false);
    }
  }

  const supervisor = canSupervise(user);
  const frontDesk = hasDept(user, ['front desk']);
  const maintenance = hasDept(user, ['maintenance', 'housekeeping']);
  const marketing = hasDept(user, ['marketing']);
  const openRequests = requests.filter(request => !['Done', 'Rejected'].includes(request.status)).length;
  const urgentTeam = [...teamTasks, ...guests, ...fixes].filter(item => item.priority === 'Urgent' || item.urgency === 'Urgent').length;
  const supervisorStats = [
    { label: 'Tasks', value: teamTasks.length, href: '/tasks', tone: teamTasks.length ? 'warn-stat' : '' },
    { label: 'Urgent', value: urgentTeam, href: '/tasks', tone: urgentTeam ? 'urgent-stat' : '' },
    { label: 'Requests', value: openRequests, href: '/requests' },
    { label: 'Shift', value: shiftNotes.length, href: '/shift' },
    ...(frontDesk ? [{ label: 'Guests', value: guests.length, href: '/guests' }] : []),
    ...((frontDesk || maintenance) ? [{ label: 'Fixes', value: fixes.length, href: '/fixes' }] : []),
    ...(marketing ? [{ label: 'Posts', value: posts.length, href: '/posts' }] : []),
  ];

  return (
    <>
      <Top eyebrow={supervisor ? roleLabel(user) : 'Daily'} title={supervisor ? 'Team Work' : 'My Work'} right={<button className="btn secondary" onClick={load}>Refresh</button>} />
      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
      {saved ? <div className="pill ok" style={{ marginBottom: 12 }}>{saved}</div> : null}
      {supervisor ? (
        <div className="owner-command-grid">
          <section className="panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">Today</div>
                <h2>Team control</h2>
              </div>
              <Pill value={`${urgentTeam} urgent`} />
            </div>
            <div className="command-metrics">
              <Link href="/tasks"><span>Team tasks</span><b>{teamTasks.length}</b></Link>
              <Link href="/requests"><span>Requests</span><b>{openRequests}</b></Link>
              <Link href="/shift"><span>Handover</span><b>{shiftNotes.length}</b></Link>
              <Link href="/departments"><span>People</span><b>{meta.users?.length || 0}</b></Link>
            </div>
          </section>
          <section className="panel">
            <div className="section-head"><h2>Quick action</h2><Pill value={user?.departments?.[0]?.name || 'Department'} /></div>
            <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
              <Link className="btn" href="/tasks">Task</Link>
              <Link className="btn secondary" href="/shift">Shift note</Link>
              <Link className="btn secondary" href="/requests">Request</Link>
              {frontDesk ? <Link className="btn secondary" href="/guests">Guest</Link> : null}
              {(frontDesk || maintenance) ? <Link className="btn secondary" href="/fixes">Fix</Link> : null}
              {marketing ? <Link className="btn secondary" href="/posts">Post</Link> : null}
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="owner-command-grid">
            <section className="panel">
              <div className="section-head">
                <div>
                  <div className="eyebrow">Today</div>
                  <h2>My day</h2>
                </div>
                <Pill value={user?.departments?.[0]?.name || 'Department'} />
              </div>
              <div className="command-metrics">
                <Link href="/tasks"><span>Tasks</span><b>{tasks.length}</b></Link>
                <Link href="/requests"><span>Requests</span><b>{requests.length}</b></Link>
                <Link href="/shift"><span>Shift</span><b>{shiftNotes.length}</b></Link>
                <Link href="/departments"><span>Dept</span><b>{user?.departments?.length || 0}</b></Link>
              </div>
            </section>
            <section className="panel">
              <div className="section-head"><h2>Shift note</h2><Pill value={shiftForm.urgency} /></div>
              <div className="form" style={{ marginTop: 12 }}>
                <div className="form-grid">
                  <label className="label">Title<input className="input" value={shiftForm.title || ''} onChange={e => setShiftForm({ ...shiftForm, title: e.target.value })} /></label>
                  <label className="label">Shift<select className="select" value={shiftForm.shift || 'AM'} onChange={e => setShiftForm({ ...shiftForm, shift: e.target.value })}>{shifts.map(shift => <option key={shift}>{shift}</option>)}</select></label>
                  <label className="label">Tag<select className="select" value={shiftForm.category || 'Other'} onChange={e => setShiftForm({ ...shiftForm, category: e.target.value })}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
                  <label className="label">Priority<select className="select" value={shiftForm.urgency || 'Normal'} onChange={e => setShiftForm({ ...shiftForm, urgency: e.target.value })}>{priorities.map(priority => <option key={priority}>{priority}</option>)}</select></label>
                </div>
                <label className="label">Note<textarea className="textarea" value={shiftForm.note || ''} onChange={e => setShiftForm({ ...shiftForm, note: e.target.value })} /></label>
                <button className="btn" disabled={busy} onClick={saveShiftNote}>Send note</button>
              </div>
            </section>
          </div>
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="section-head"><h2>Request</h2><Pill value={requestForm.urgency} /></div>
            <div className="form" style={{ marginTop: 12 }}>
              <div className="form-grid">
                <label className="label">Request<input className="input" value={requestForm.title || ''} onChange={e => setRequestForm({ ...requestForm, title: e.target.value })} /></label>
                <label className="label">Type<select className="select" value={requestForm.request_type || 'General'} onChange={e => setRequestForm({ ...requestForm, request_type: e.target.value })}>{requestTypes.map(type => <option key={type}>{type}</option>)}</select></label>
                <label className="label">Priority<select className="select" value={requestForm.urgency || 'Normal'} onChange={e => setRequestForm({ ...requestForm, urgency: e.target.value })}>{priorities.map(priority => <option key={priority}>{priority}</option>)}</select></label>
              </div>
              <label className="label">Reason<textarea className="textarea" value={requestForm.reason || ''} onChange={e => setRequestForm({ ...requestForm, reason: e.target.value })} /></label>
              <button className="btn secondary" disabled={busy} onClick={saveRequest}>Send request</button>
            </div>
          </section>
        </>
      )}

      {supervisor ? (
        <div className={supervisorStats.length <= 4 ? 'ops-strip compact' : 'ops-strip'}>
          {supervisorStats.map(item => <StatLink key={item.label} label={item.label} value={item.value} href={item.href} tone={item.tone} />)}
        </div>
      ) : null}

      <div className="grid cols-2">
        <section className="panel">
          <h2>{supervisor ? 'Assigned to me' : 'Tasks'}</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {tasks.length ? tasks.map(task => <WorkCard key={task.id} item={task} href="/tasks" kind="Task" users={meta.users} />) : <div className="empty">All clear</div>}
          </div>
        </section>
        {supervisor ? (
          <section className="panel">
            <h2>Team queue</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              {teamTasks.length ? teamTasks.map(task => <WorkCard key={task.id} item={task} href="/tasks" kind="Team" users={meta.users} />) : <div className="empty">All clear</div>}
            </div>
          </section>
        ) : null}
        <section className="panel">
          <h2>Shift</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {shiftNotes.length ? shiftNotes.map(note => <WorkCard key={note.id} item={note} href="/shift" kind="Shift" users={meta.users} />) : <div className="empty">No notes</div>}
          </div>
        </section>
        <section className="panel">
          <h2>Requests</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {requests.length ? requests.map(request => <WorkCard key={request.id} item={request} href="/requests" kind="Request" users={meta.users} />) : <div className="empty">No requests</div>}
          </div>
        </section>
        {supervisor && (frontDesk || maintenance) ? (
          <section className="panel">
            <h2>{frontDesk ? 'Guests' : 'Fixes'}</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              {frontDesk && guests.length ? guests.map(item => <WorkCard key={item.id} item={item} href="/guests" kind="Guest" users={meta.users} />) : null}
              {!frontDesk && fixes.length ? fixes.map(item => <WorkCard key={item.id} item={item} href="/fixes" kind="Fix" users={meta.users} />) : null}
              {frontDesk && !guests.length ? <div className="empty">All clear</div> : null}
              {!frontDesk && !fixes.length ? <div className="empty">All clear</div> : null}
            </div>
          </section>
        ) : null}
        {supervisor && frontDesk && fixes.length ? (
          <section className="panel">
            <h2>Fixes</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              {fixes.map(item => <WorkCard key={item.id} item={item} href="/fixes" kind="Fix" users={meta.users} />)}
            </div>
          </section>
        ) : null}
        {supervisor && marketing ? (
          <section className="panel">
            <h2>Posts</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              {posts.length ? posts.map(post => <WorkCard key={post.id} item={post} href="/posts" kind="Post" users={meta.users} />) : <div className="empty">All clear</div>}
            </div>
          </section>
        ) : null}
        <section className="panel">
          <h2>Department</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {(user?.departments || []).map((dept: Entity) => (
              <Link className="card row-card" href={`/departments?dept=${dept.id}`} key={dept.id}>
                <div className="card-title">{dept.name}</div>
                <div className="card-line"><Pill value={dept.is_primary ? 'Primary' : 'Access'} /></div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
