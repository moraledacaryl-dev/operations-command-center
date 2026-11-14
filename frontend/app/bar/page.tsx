'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getStoredUser, setCurrentDepartmentId } from '@/lib/session';
import { hasCapability, normalizeRole } from '@/lib/capabilities';
import { Top } from '@/components/Top';

const kinds = ['Low stock', 'Equipment', 'Drink complaint', 'Handover', 'Other'] as const;
const actionNames: Record<string, string> = {
  acknowledge: 'Mark as read', 'follow-up-new': 'Needs follow-up', 'follow-up-seen': 'Needs follow-up',
  'resolve-new': 'Mark finished', 'resolve-seen': 'Mark finished', 'resolve-follow': 'Mark finished',
  reopen: 'Reopen',
};
type Report = { title: string; kind: typeof kinds[number] | ''; details: string; urgency: string; shift: string };
const empty: Report = { title: '', kind: '', details: '', urgency: 'Normal', shift: '' };

export default function BarPage() {
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [reports, setReports] = useState<Entity[]>([]);
  const [tasks, setTasks] = useState<Entity[]>([]);
  const [people, setPeople] = useState<Entity[]>([]);
  const [assignee, setAssignee] = useState('');
  const [selected, setSelected] = useState<Entity | null>(null);
  const [report, setReport] = useState<Report>(empty);
  const [showForm, setShowForm] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const user = getStoredUser();
  const canManage = hasCapability(user, 'manage_department');

  const load = useCallback(async (id: number) => {
    try {
      const [notes, teamTasks] = await Promise.all([
        api.list('shift-notes', { department_id: id, active: true }),
        api.list('tasks', { department_id: id, active: true }),
      ]);
      setReports(notes); setTasks(teamTasks);
    } catch (err: any) { setError(err.message || 'Could not load Bar work.'); }
  }, []);

  useEffect(() => {
    let active = true;
    api.meta().then(meta => {
      if (!active) return;
      const bar = (meta.departments || []).find((item: Entity) => item.name === 'Bar');
      const id = bar ? Number(bar.id) : null;
      setDepartmentId(id); setChecked(true);
      setPeople((meta.users || []).filter((person: Entity) => hasCapability(person, 'view_all_operations')
        || ['owner', 'admin', 'manager'].includes(normalizeRole(person.role))
        || id && (Number(person.primary_department_id) === id
          || (person.departments || []).some((dept: Entity) => Number(dept.id) === id))));
      if (id && getStoredUser()?.departments?.some((dept: Entity) => Number(dept.id) === id)) setCurrentDepartmentId(id);
      if (id) void load(id);
    }).catch(err => { if (active) { setError(err.message || 'Could not open Bar.'); setChecked(true); } });
    return () => { active = false; };
  }, [load]);

  async function submit() {
    if (!departmentId || busy || !report.kind || report.title.trim().length < 4 || report.details.trim().length < 8) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await api.reportBarProblem({ title: report.title.trim(), kind: report.kind, details: report.details.trim(),
        urgency: report.urgency, shift: report.shift || null });
      setShowForm(false); setReport(empty); setSuccess('Bar report saved. The team can now see it.');
      await load(departmentId);
    } catch (err: any) { setError(err.message || 'Report not saved. Try again.'); }
    finally { setBusy(false); }
  }

  async function openNote(id: number) {
    try { setSelected(await api.get('shift-notes', id)); setComment(''); setAssignee(''); setSuccess(''); }
    catch (err: any) { setError(err.message || 'Could not open this report.'); }
  }

  async function assignTask() {
    if (!selected || !departmentId || !assignee || busy) return;
    const reportId = Number(selected.id);
    setBusy(true); setError(''); setSuccess('');
    try {
      const result = await api.assignBarReport(reportId, Number(assignee));
      setSelected(current => Number(current?.id) === reportId ? { ...current, linked_task_id: result.task.id } : current);
      setAssignee('');
      setSuccess(result.created ? 'Task assigned. The team member can find it in My Work.' : 'This report already has that task.');
      await load(departmentId);
    } catch (err: any) { setError(err.message || 'Task not assigned. Try again.'); }
    finally { setBusy(false); }
  }

  async function followUp(action?: string) {
    if (!selected || !departmentId || busy) return;
    setBusy(true); setError('');
    try {
      if (action) await api.workflowAction('shift-notes', selected.id, action, { note: comment.trim() || null });
      else if (comment.trim()) await api.comment('shift-notes', selected.id, comment.trim());
      setSelected(await api.get('shift-notes', selected.id)); setComment(''); await load(departmentId);
    } catch (err: any) { setError(err.message || 'Could not save this update.'); }
    finally { setBusy(false); }
  }

  if (!checked) return <div className="ops-module"><Top title="Bar" /><p role="status">Opening Bar workspace…</p></div>;
  if (!departmentId) return <div className="ops-module"><Top title="Bar" /><section className="panel"><h2>Bar access needed</h2><p>This account does not have Bar access. Ask your manager to add Bar to your departments. Your Kitchen and Café access stays separate.</p>{error ? <p role="alert">{error}</p> : null}</section></div>;

  return <div className="ops-module" data-testid="bar-workspace">
    <Top title="Bar" right={<button className="btn" data-testid="bar-open-report" onClick={() => setShowForm(value => !value)}>{showForm ? 'Close form' : 'Report a problem'}</button>} />
    <p>Alcoholic drinks and mocktails. Kitchen handles food. Café handles café drinks and service.</p>
    <p className="muted">Use this page for Bar reports and handovers.</p>
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    {success ? <p role="status">{success}</p> : null}
    {showForm ? <section className="panel" data-testid="bar-report-form">
      <h2>Tell the Bar team what happened</h2>
      <p>Describe the problem and what the next person needs to do. Use real details only in the live app.</p>
      <div className="form">
        <label className="label">What happened?<input className="input" maxLength={180} value={report.title} onChange={e => setReport({ ...report, title: e.target.value })} placeholder="Example: Mocktail blender stopped working" /></label>
        <label className="label">Type of report<select className="select" value={report.kind} required onChange={e => setReport({ ...report, kind: e.target.value as Report['kind'] })}><option value="">Choose the type</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
        <label className="label">What should the next shift know?<textarea className="textarea" rows={4} maxLength={3000} value={report.details} onChange={e => setReport({ ...report, details: e.target.value })} placeholder="Where is the problem? What have you done? Who needs to check it next?" /></label>
        <div className="form-grid">
          <label className="label">When does this need attention?<select className="select" value={report.urgency} onChange={e => setReport({ ...report, urgency: e.target.value })}><option value="Low">Can wait</option><option value="Normal">Normal</option><option value="High">Soon</option><option value="Urgent">Urgent — tell your lead now</option></select></label>
          <label className="label">Your shift (optional)<select className="select" value={report.shift} onChange={e => setReport({ ...report, shift: e.target.value })}><option value="">Choose your shift</option><option>AM</option><option>PM</option><option>Night</option></select></label>
        </div>
        <div className="toolbar"><button className="btn" data-testid="bar-save-report" disabled={busy || !report.kind || report.title.trim().length < 4 || report.details.trim().length < 8} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save Bar report'}</button><button className="btn secondary" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button></div>
      </div>
    </section> : null}
    <section className="panel" id="bar-tasks" style={{ marginTop: 16 }}>
      <h2>Bar tasks</h2>
      {tasks.length ? tasks.slice(0, 8).map(item => <p key={item.id}><strong>{item.title}</strong> · {item.status || 'To Do'}</p>) : <p>No active Bar tasks.</p>}
      <Link className="btn secondary" href="/tasks" onClick={() => setCurrentDepartmentId(departmentId)}>See tasks</Link>
    </section>
    <section className="panel" id="bar-handovers" style={{ marginTop: 16 }}>
      <h2>Bar reports and handovers</h2>
      <p>Open a report to read updates. Add a note when you have new information.</p>
      <div className="grid cols-2" data-testid="bar-reports">
        {reports.length ? reports.map(item => <button className="card" type="button" key={item.id} style={{ textAlign: 'left' }} onClick={() => void openNote(Number(item.id))}><strong>{item.title}</strong><p>{item.category || 'Handover'} · {item.status} · {item.urgency}</p><p className="muted">{item.note}</p></button>) : <p>No Bar reports yet.</p>}
      </div>
    </section>
    {selected ? <section className="panel" style={{ marginTop: 16 }} data-testid="bar-report-details">
      <h2>{selected.title}</h2><p>{selected.note}</p><p>{selected.status} · {selected.urgency}</p>
      {(selected.comments || []).map((item: Entity) => <p key={item.id}><strong>{item.author_name || 'Team member'}:</strong> {item.body}</p>)}
      <label className="label">Add an update<textarea className="textarea" value={comment} onChange={e => setComment(e.target.value)} placeholder="What changed? What still needs to happen?" /></label>
      <div className="toolbar"><button className="btn" disabled={busy || !comment.trim()} onClick={() => void followUp()}>Save update</button>
        {canManage && (selected.allowed_actions || []).map((action: string) => <button className="btn secondary" disabled={busy || (action === "reopen" && !comment.trim())} key={action} onClick={() => void followUp(action)}>{actionNames[action] || action}</button>)}
        <button className="btn secondary" onClick={() => setSelected(null)}>Close report</button>
      </div>
      {selected.linked_task_id ? <div role="status"><p>This report has a linked task. <Link href="/tasks" onClick={() => setCurrentDepartmentId(departmentId)}>See Bar tasks</Link></p>
        {tasks.filter(task => Number(task.id) === Number(selected.linked_task_id)).map(task => <p key={task.id}>
          {task.status || 'To Do'} · Assigned to {people.find(person => Number(person.id) === Number(task.assigned_to_id))?.name || 'team member'}
        </p>)}
        {!tasks.some(task => Number(task.id) === Number(selected.linked_task_id)) ? <p>This task is not in the active Bar list. Ask a manager to check it.</p> : null}</div>
        : canManage && selected.status !== 'Done' ? <div className="form" data-testid="bar-assign-task">
          <label className="label">Who should handle this?<select className="select" value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="">Choose a team member</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          {!people.length ? <p>No team members are available. Ask a manager to check Bar access.</p> : null}
          <div><button className="btn secondary" disabled={busy || !assignee} onClick={() => void assignTask()}>Assign task</button></div>
        </div> : !canManage ? <p className="muted">Tell your lead if the problem is urgent or needs an assignment.</p> : null}
    </section> : null}
  </div>;
}
