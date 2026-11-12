'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getStoredUser, setCurrentDepartmentId } from '@/lib/session';
import { hasCapability } from '@/lib/capabilities';
import { Top } from '@/components/Top';

const suggestedChecks = {
  opening: 'Wash hands and check soap and clean towels.\nClean and sanitize the bar and drink tools.\nCheck that ice, fruit and other ingredients are clean, fresh and stored safely.\nCheck the fridge and equipment are working; tell the lead about any problem.\nCheck glasses, drinks and supplies. Tell the lead what is running low.',
  closing: 'Wash and sanitize the bar, drink tools and work surfaces.\nCover, label and store ingredients safely; deal with ice as directed by the lead.\nCheck and put away bottles, glasses and supplies.\nSwitch off only equipment the lead has approved for shutdown; leave fridges running.\nSecure alcohol and cash if this is your responsibility.\nTell the next shift about low stock, faults and unfinished work.',
};
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
  const [routines, setRoutines] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [report, setReport] = useState<Report>(empty);
  const [showForm, setShowForm] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [checkEditor, setCheckEditor] = useState<'opening' | 'closing' | null>(null);
  const [checkSteps, setCheckSteps] = useState('');
  const [editingCheck, setEditingCheck] = useState<Entity | null>(null);
  const user = getStoredUser();
  const canManage = hasCapability(user, 'manage_department');

  const load = useCallback(async (id: number) => {
    try {
      const [notes, teamTasks, teamRoutines] = await Promise.all([
        api.list('shift-notes', { department_id: id, active: true }),
        api.list('tasks', { department_id: id, active: true }),
        api.list('routines', { department_id: id, active: true }),
      ]);
      setReports(notes); setTasks(teamTasks); setRoutines(teamRoutines);
    } catch (err: any) { setError(err.message || 'Could not load Bar work.'); }
  }, []);

  useEffect(() => {
    let active = true;
    api.meta().then(meta => {
      if (!active) return;
      const bar = (meta.departments || []).find((item: Entity) => item.name === 'Bar');
      const id = bar ? Number(bar.id) : null;
      setDepartmentId(id); setChecked(true);
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
    try { setSelected(await api.get('shift-notes', id)); setComment(''); }
    catch (err: any) { setError(err.message || 'Could not open this report.'); }
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

  const checks = (word: string) => routines.filter(item => String(item.title || '').toLowerCase().includes(word) && String(item.status || 'Active').toLowerCase() === 'active');

  async function saveChecks() {
    if (!canManage || !departmentId || !checkEditor || checkSteps.trim().length < 5 || busy) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const latest = await api.list('routines', { department_id: departmentId, active: true });
      const keyword = checkEditor === 'opening' ? 'open' : 'clos';
      if (editingCheck) {
        const current = latest.find((item: Entity) => item.id === editingCheck.id);
        if (!current || current.checklist !== editingCheck.checklist || current.updated_at !== editingCheck.updated_at || current.status !== editingCheck.status) {
          setError('These checks changed. Refresh and review them before saving.');
          await load(departmentId);
          return;
        }
        await api.update('routines', editingCheck.id, { checklist: checkSteps.trim() });
      } else if (latest.some((item: Entity) => String(item.title || '').toLowerCase().includes(keyword) && String(item.status || 'Active').toLowerCase() === 'active')) {
        setError('These checks were added already. Refresh to see them.');
        await load(departmentId);
        return;
      }
      else await api.create('routines', { department_id: departmentId, title: `Bar ${checkEditor} checks`,
        checklist: checkSteps.trim(), frequency: 'Every shift', priority: 'Normal', status: 'Active' });
      setCheckEditor(null); setEditingCheck(null); setCheckSteps(''); setSuccess('Bar checks saved for the team.');
      await load(departmentId);
    } catch (err: any) { setError(err.message || 'Could not save the checks. Try again.'); }
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
    <div className="grid cols-2" style={{ marginTop: 16 }}>
      <section className="panel" id="bar-checks">
        <h2>Opening checks</h2>
        {checks('open').length ? checks('open').map(item => <p key={item.id}><strong>{item.title}</strong><span className="muted" style={{ display: "block", whiteSpace: "pre-line" }}>{item.checklist || 'Ask your lead for the steps.'}</span></p>) : <p>No opening checklist has been added for Bar. Ask your lead to add the approved steps under Routines.</p>}
        {canManage && !checks('open').length && <button className="btn secondary" onClick={() => { setCheckEditor('opening'); setEditingCheck(null); setCheckSteps(''); }}>Add opening checks</button>}
        {canManage && checks("open").length === 1 && <button className="btn secondary" onClick={() => { const item = checks("open")[0]; setCheckEditor("opening"); setEditingCheck(item); setCheckSteps(String(item.checklist || "")); }}>Edit opening checks</button>}
        <h2>Closing checks</h2>
        {checks('clos').length ? checks('clos').map(item => <p key={item.id}><strong>{item.title}</strong><span className="muted" style={{ display: "block", whiteSpace: "pre-line" }}>{item.checklist || 'Ask your lead for the steps.'}</span></p>) : <p>No closing checklist has been added for Bar. Ask your lead to add the approved steps under Routines.</p>}
        {canManage && !checks('clos').length && <button className="btn secondary" onClick={() => { setCheckEditor('closing'); setEditingCheck(null); setCheckSteps(''); }}>Add closing checks</button>}
        {canManage && checks("clos").length === 1 && <button className="btn secondary" onClick={() => { const item = checks("clos")[0]; setCheckEditor("closing"); setEditingCheck(item); setCheckSteps(String(item.checklist || "")); }}>Edit closing checks</button>}
        {canManage && checkEditor && <div className="form">
          <label className="label">{checkEditor === 'opening' ? 'Opening steps' : 'Closing steps'}
            <textarea className="textarea" rows={5} maxLength={4000} value={checkSteps} onChange={event => setCheckSteps(event.target.value)} placeholder="Write your approved steps, one per line." />
          </label>
          <button type="button" className="btn secondary" onClick={() => setCheckSteps(suggestedChecks[checkEditor])}>Use suggested steps</button>
          <p>Suggested steps are a starting point. Check and adjust them for your bar before saving; staff will see what you save.</p>
          <div className="toolbar"><button className="btn" disabled={busy || checkSteps.trim().length < 5} onClick={() => void saveChecks()}>Save checks for Bar</button><button className="btn secondary" disabled={busy} onClick={() => setCheckEditor(null)}>Cancel</button></div>
        </div>}
        <p className="muted">Only follow checklists approved by your workplace.</p>
        {canManage ? <Link className="btn secondary" href="/departments" onClick={() => setCurrentDepartmentId(departmentId)}>View Bar routines</Link> : null}
      </section>
      <section className="panel">
        <h2>Bar tasks</h2>
        {tasks.length ? tasks.slice(0, 8).map(item => <p key={item.id}><strong>{item.title}</strong> · {item.status || 'To Do'}</p>) : <p>No active Bar tasks.</p>}
        <Link className="btn secondary" href="/tasks" onClick={() => setCurrentDepartmentId(departmentId)}>See tasks</Link>
      </section>
    </div>
    <section className="panel" style={{ marginTop: 16 }}>
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
      {canManage ? <p className="muted">Need someone to handle this? Create and assign a Bar task in <Link href="/tasks">Tasks</Link>.</p> : <p className="muted">Tell your lead if the problem is urgent or needs an assignment.</p>}
    </section> : null}
  </div>;
}
