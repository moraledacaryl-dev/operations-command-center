'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Drawer } from '@/components/Drawer';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { LoadingPanel } from '@/components/LoadingPanel';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';

const columns = ['To Do', 'Doing', 'Review', 'Done'];

function dueLabel(value?: string) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default function TeamTasksPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [query, setQuery] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { departmentId, hydrated } = useActiveDepartment();
  const beginRequest = useLatestRequest();

  const openCreate = useCallback(() => setShowAdd(true), []);
  useCreateIntent(openCreate);

  const load = useCallback(async () => {
    if (!hydrated) return;
    const request = beginRequest();
    setLoading(true);
    try {
      setError('');
      const rows = await api.listAll('tasks', { active: true, department_id: departmentId || '' }, { signal: request.signal });
      if (request.isCurrent()) setItems(rows);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Team tasks could not be loaded.');
    } finally { if (request.isCurrent()) setLoading(false); }
  }, [beginRequest, departmentId, hydrated]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items.filter(item => !query.trim() || [item.title, item.note, item.status, item.priority].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())), [items, query]);
  const overdue = visible.filter(item => item.due_date && !['Done'].includes(item.status) && new Date(item.due_date).getTime() < Date.now()).length;

  async function createTask() {
    if (!title.trim() || busy || !hydrated) return;
    setBusy(true);
    try {
      await api.create('tasks', { title: title.trim(), due_date: dueDate || null, priority, status: 'To Do', department_id: departmentId || null });
      setTitle(''); setDueDate(''); setPriority('Normal'); setShowAdd(false); await load();
    } catch (err: any) {
      setError(err.message || 'Task could not be created.');
    } finally { setBusy(false); }
  }

  async function move(item: Entity, status: string) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.workflowAction('tasks', item.id, status, { note: actionNote.trim() || null });
      if (selected?.id === item.id) setSelected({ ...selected, ...updated });
      setActionNote('');
      await load();
    } catch (err: any) { setError(err.message || 'Task could not be updated.'); }
    finally { setBusy(false); }
  }

  if (!hydrated || loading) return <><Top eyebrow="Team execution" title="Tasks" /><LoadingPanel label="Loading team tasks…" /></>;

  return <>
    <Top eyebrow="Team execution" title="Tasks" right={<button data-testid="create-task" className="btn" onClick={() => setShowAdd(value => !value)}>New task</button>} />
    <div className="grid cols-3 task-kpis" style={{ marginBottom: 16 }}>
      <div className="panel task-kpi"><div className="task-kpi-label">Active</div><h2>{visible.filter(item => item.status !== 'Done').length}</h2></div>
      <div className="panel task-kpi"><div className="task-kpi-label">In review</div><h2>{visible.filter(item => item.status === 'Review').length}</h2></div>
      <div className="panel task-kpi"><div className="task-kpi-label">Overdue</div><h2>{overdue}</h2></div>
    </div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {showAdd ? <section className="panel" style={{ marginBottom: 16 }}>
      <h2>Create team task</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Task title<input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="label">Due date<input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
        <label className="label">Priority<select className="select" value={priority} onChange={e => setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
      </div>
      <div className="toolbar"><button className="btn" disabled={busy || !title.trim()} onClick={createTask}>{busy ? 'Saving…' : 'Create task'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <div className="toolbar"><input className="input" placeholder="Search team tasks" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="grid cols-4" data-testid="tasks-board">
      {columns.map(status => <section className="panel" key={status}>
        <div className="card-line" style={{ justifyContent: 'space-between' }}><h2>{status}</h2><Pill value={String(visible.filter(item => item.status === status).length)} /></div>
        <div className="grid" style={{ marginTop: 12 }}>
          {visible.filter(item => item.status === status).map(item => <button type="button" className="card" key={item.id} onClick={async () => { try { setSelected(await api.get('tasks', item.id)); } catch (err: any) { setError(err.message || 'Task could not be opened.'); } }} style={{ textAlign: 'left' }}>
            <strong>{item.title}</strong>
            <span className="card-line"><Pill value={item.priority || 'Normal'} />{item.project_id ? <Pill value="Project task" /> : null}</span>
            <span className="muted">{dueLabel(item.due_date)}</span>
          </button>)}
          {!visible.some(item => item.status === status) ? <div className="empty">No tasks</div> : null}
        </div>
      </section>)}
    </div>
    <Drawer item={selected} title="Team task" onClose={() => setSelected(null)}>
      {selected ? <section className="panel"><h2>Move task</h2>{(selected.allowed_actions || []).some((action: string) => ['request-changes', 'reopen'].includes(action)) ? <label className="label">Reason<textarea className="textarea" value={actionNote} onChange={event => setActionNote(event.target.value)} /></label> : null}<div className="toolbar">{(selected.allowed_actions || []).map((action: string) => <button className="btn small secondary" key={action} disabled={busy || (['request-changes', 'reopen'].includes(action) && !actionNote.trim())} onClick={() => move(selected, action)}>{({ start: 'Start work', 'submit-review': 'Submit for review', 'request-changes': 'Request changes', complete: 'Complete', reopen: 'Reopen' } as Record<string, string>)[action] || action}</button>)}</div>{!(selected.allowed_actions || []).length ? <p className="muted">No task transition is available for your role and this state.</p> : null}</section> : null}
    </Drawer>
  </>;
}
