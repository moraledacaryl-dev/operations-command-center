'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { isOverduePropertyDay, propertyDateInput } from '@/lib/property-dates';
import { Drawer } from '@/components/Drawer';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { WorkspaceStats } from '@/components/WorkspaceStats';
import { Top } from '@/components/Top';
import { LoadingPanel } from '@/components/LoadingPanel';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';
import { getStoredUser } from '@/lib/session';
import { hasCapability, normalizeRole } from '@/lib/capabilities';

const columns = ['To Do', 'Doing', 'Review', 'Done'];

function dueLabel(value?: string) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(value));
}

function assigneesFor(people: Entity[], departmentId: number | null | undefined) {
  return people.filter(person => hasCapability(person, 'view_all_operations')
    || ['owner', 'admin', 'manager'].includes(normalizeRole(person.role))
    || departmentId && (Number(person.primary_department_id) === Number(departmentId)
      || (person.departments || []).some((department: Entity) => Number(department.id) === Number(departmentId))));
}

function AssigneeSelect({ people, value, onChange }: { people: Entity[]; value: string; onChange: (value: string) => void }) {
  return <label className="label">Assigned to<select className="select" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Unassigned</option>
    {value && !people.some(person => String(person.id) === value) ? <option value={value}>Current assignee (unavailable)</option> : null}
    {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
  </select></label>;
}

function TaskEditor({ item, people, busy, onSave, onCancel }: {
  item: Entity; people: Entity[]; busy: boolean; onSave: (payload: Entity) => Promise<void>; onCancel: () => void;
}) {
  const [original] = useState(item);
  const [title, setTitle] = useState(item.title || '');
  const [assigned, setAssigned] = useState(item.assigned_to_id ? String(item.assigned_to_id) : '');
  const [priority, setPriority] = useState(item.priority || 'Normal');
  const [date, setDate] = useState(propertyDateInput(item.due_date));
  const [note, setNote] = useState(item.note || '');
  return <section className="panel"><h2>Edit task</h2><form className="form" onSubmit={event => {
    event.preventDefault();
    if (busy || !title.trim() || !original.updated_at) return;
    void onSave({ title: title.trim(), assigned_to_id: assigned ? Number(assigned) : null, priority,
      due_date: date === propertyDateInput(original.due_date) ? original.due_date || null : date || null,
      note: note.trim() || null, expected_updated_at: original.updated_at });
  }}>
    <label className="label">Task title<input className="input" required maxLength={180} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <AssigneeSelect people={people} value={assigned} onChange={setAssigned} />
    <label className="label">Priority<select className="select" value={priority} onChange={event => setPriority(event.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
    <label className="label">Due date<input className="input" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <label className="label">Notes<textarea className="textarea" value={note} onChange={event => setNote(event.target.value)} /></label>
    {!original.updated_at ? <p role="alert">Reopen the task to load its current details before editing.</p> : null}
    <div className="toolbar"><button className="btn" disabled={busy || !title.trim() || !original.updated_at}>{busy ? 'Saving…' : 'Save changes'}</button><button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel editing</button></div>
  </form></section>;
}

export default function TeamTasksPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [assignee, setAssignee] = useState('');
  const [people, setPeople] = useState<Entity[]>([]);
  const [peopleError, setPeopleError] = useState('');
  const [editing, setEditing] = useState(false);
  const openRequest = useRef(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'Board' | 'List'>('Board');
  const [actionNote, setActionNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { departmentId, hydrated } = useActiveDepartment();
  const canManageWork = hasCapability(getStoredUser(), 'manage_department');
  const beginRequest = useLatestRequest();

  const openCreate = useCallback(() => {
    if (hasCapability(getStoredUser(), 'manage_department')) setShowAdd(true);
  }, []);
  useCreateIntent(openCreate);

  const load = useCallback(async (silent = false) => {
    if (!hydrated) return;
    const request = beginRequest();
    // Status changes refresh list data without unmounting the open drawer.
    if (!silent) setLoading(true);
    try {
      setError('');
      const rows = await api.listAll('tasks', { active: true, department_id: departmentId || '' }, { signal: request.signal });
      if (request.isCurrent()) setItems(rows);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Team tasks could not be loaded.');
    } finally { if (request.isCurrent() && !silent) setLoading(false); }
  }, [beginRequest, departmentId, hydrated]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canManageWork) return;
    let active = true;
    api.meta().then(meta => { if (active) setPeople(meta.users || []); })
      .catch(() => { if (active) setPeopleError('Team choices could not be loaded. Reopen this page to retry.'); });
    return () => { active = false; };
  }, [canManageWork]);

  const visible = useMemo(() => items.filter(item => !query.trim() || [item.title, item.note, item.status, item.priority].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())), [items, query]);
  const overdue = visible.filter(item => item.status !== 'Done' && isOverduePropertyDay(item.due_date)).length;

  async function createTask() {
    if (!title.trim() || busy || !hydrated) return;
    setBusy(true);
    try {
      await api.create('tasks', { title: title.trim(), due_date: dueDate || null, priority, status: 'To Do', department_id: departmentId || null, assigned_to_id: assignee ? Number(assignee) : null });
      setTitle(''); setDueDate(''); setPriority('Normal'); setAssignee(''); setShowAdd(false); await load();
    } catch (err: any) {
      setError(err.message || 'Task could not be created.');
    } finally { setBusy(false); }
  }

  async function move(item: Entity, status: string) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.workflowAction('tasks', item.id, status, { note: actionNote.trim() || null });
      setSelected(current => current?.id === item.id ? { ...current, ...updated } : current);
      setActionNote('');
      await load(true);
    } catch (err: any) { setError(err.message || 'Task could not be updated.'); }
    finally { setBusy(false); }
  }

  async function openTask(id: number) {
    const request = ++openRequest.current;
    try {
      const detail = await api.get('tasks', id);
      if (request === openRequest.current) { setSelected(detail); setEditing(false); setError(''); setActionNote(''); }
    } catch (err: any) { if (request === openRequest.current) setError(err.message || 'Task could not be opened.'); }
  }

  async function saveTask(payload: Entity) {
    if (!selected || busy || !canManageWork) return;
    const id = selected.id;
    setBusy(true); setError('');
    try {
      const updated = await api.update('tasks', id, payload);
      setSelected(current => current?.id === id ? { ...current, ...updated } : current);
      setEditing(false);
      await load(true);
    } catch (err: any) { setError(err.message || 'Task could not be saved. Your changes are still in the form.'); }
    finally { setBusy(false); }
  }

  if (!hydrated || loading) return <><Top title="Tasks" /><LoadingPanel label="Loading team tasks…" /></>;

  return <div className="ops-module">
    <Top title="Tasks" right={canManageWork ? <button data-testid="create-task" className="btn" onClick={() => setShowAdd(value => !value)}><Icon name="plus" />New task</button> : null} />
    <WorkspaceStats items={[
      { label: 'Active tasks', value: visible.filter(item => item.status !== 'Done').length, icon: 'tasks' },
      { label: 'Waiting for review', value: visible.filter(item => item.status === 'Review').length, icon: 'review' },
      { label: 'Overdue', value: overdue, icon: 'clock', attention: true },
    ]} />
    {error && !selected ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {canManageWork && showAdd ? <section data-testid="create-task-form" className="panel" style={{ marginBottom: 16 }}>
      <h2>Create team task</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Task title<input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="label">Due date<input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
        <label className="label">Priority<select className="select" value={priority} onChange={e => setPriority(e.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        <AssigneeSelect people={assigneesFor(people, departmentId ? Number(departmentId) : null)} value={assignee} onChange={setAssignee} />
      </div>
      {peopleError ? <p role="status">{peopleError}</p> : null}
      <div className="toolbar"><button className="btn" disabled={busy || !title.trim()} onClick={createTask}>{busy ? 'Saving…' : 'Create task'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <div className="task-controls"><div className="toolbar task-search"><input className="input" placeholder="Search team tasks" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="task-view-switch" role="group" aria-label="Task view"><button className={view === 'Board' ? 'active' : ''} onClick={() => setView('Board')}>Board</button><button className={view === 'List' ? 'active' : ''} onClick={() => setView('List')}>List</button></div></div>
    {view === 'Board' ? <div className="grid cols-4" data-testid="tasks-board" tabIndex={0} role="region" aria-label="Task board by workflow stage">
      {columns.map(status => <section className="panel" key={status}>
        <div className="card-line" style={{ justifyContent: 'space-between' }}><h2>{status}</h2><Pill value={String(visible.filter(item => item.status === status).length)} /></div>
        <div className="grid" style={{ marginTop: 12 }}>
          {visible.filter(item => item.status === status).map(item => <button type="button" className="card" key={item.id} onClick={() => void openTask(item.id)} style={{ textAlign: 'left' }}>
            <span className="ops-task-card-icon"><Icon name="tasks" /></span><strong>{item.title}</strong>
            {item.note ? <span className="ops-task-description">{item.note}</span> : null}
            <span className="card-line"><Pill value={item.priority || 'Normal'} />{item.project_id ? <Pill value="Project task" /> : null}</span>
            <span className="muted ops-task-date"><Icon name="clock" />{dueLabel(item.due_date)}</span>
          </button>)}
          {!visible.some(item => item.status === status) ? <div className="empty"><Icon name="check" />No tasks here</div> : null}
        </div>
      </section>)}
    </div> : <div className="task-list" data-testid="tasks-list">{visible.map(item => <button type="button" className="card task-list-item" key={item.id} onClick={() => void openTask(item.id)}><span className="task-list-state">{item.status}</span><strong>{item.title}</strong><span className="muted ops-task-date"><Icon name="clock" />{dueLabel(item.due_date)}</span><Pill value={item.priority || 'Normal'} /></button>)}{!visible.length ? <div className="empty">No tasks match this search.</div> : null}</div>}
    <Drawer item={selected} title={selected?.title || "Team task"} onClose={() => { ++openRequest.current; setSelected(null); setEditing(false); }}>
      {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      {selected && canManageWork ? editing ? <TaskEditor key={selected.id} item={selected} people={assigneesFor(people, selected.department_id)} busy={busy} onSave={saveTask} onCancel={() => { setEditing(false); setError(''); }} /> : <div className="toolbar"><button className="btn secondary" disabled={busy} onClick={() => setEditing(true)}>Edit task</button><button className="btn secondary" disabled={busy} onClick={() => void openTask(selected.id)}>Refresh details</button></div> : null}
      {peopleError && editing ? <p role="status">{peopleError}</p> : null}
      {selected && !editing ? <section className="panel"><h2>Move task</h2>{(selected.allowed_actions || []).some((action: string) => ['request-changes', 'reopen'].includes(action)) ? <label className="label">Reason<textarea className="textarea" value={actionNote} onChange={event => setActionNote(event.target.value)} /></label> : null}<div className="toolbar">{(selected.allowed_actions || []).map((action: string) => <button className="btn small secondary" key={action} disabled={busy || (['request-changes', 'reopen'].includes(action) && !actionNote.trim())} onClick={() => move(selected, action)}>{({ start: 'Start work', 'submit-review': 'Submit for review', 'request-changes': 'Request changes', complete: 'Complete', reopen: 'Reopen' } as Record<string, string>)[action] || action}</button>)}</div>{!(selected.allowed_actions || []).length ? <p className="muted">No task transition is available for your role and this state.</p> : null}</section> : null}
    </Drawer>
  </div>;
}
