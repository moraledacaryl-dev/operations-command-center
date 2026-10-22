'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { isOverduePropertyDay } from '@/lib/property-dates';
import { Drawer } from '@/components/Drawer';
import { Tabs } from '@/components/Tabs';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { Icon } from '@/components/Icon';
import { WorkspaceStats } from '@/components/WorkspaceStats';

import { LoadingPanel } from '@/components/LoadingPanel';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';
import { hasCapability } from '@/lib/capabilities';
import { getStoredUser } from '@/lib/session';

type EnrichedProject = Entity & {
  linked_tasks: Entity[];
  progress: number;
  overdue_tasks: number;
};

function formatDate(value?: string) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Entity[]>([]);
  const [tasks, setTasks] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<EnrichedProject | null>(null);
  const [filter, setFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [note, setNote] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [taskNote, setTaskNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { departmentId, hydrated } = useActiveDepartment();
  const beginRequest = useLatestRequest();
  const [user] = useState(() => getStoredUser());
  const canManage = hasCapability(user, 'manage_department');

  const openCreate = useCallback(() => { if (canManage) setShowAdd(true); }, [canManage]);
  useCreateIntent(openCreate);

  const load = useCallback(async () => {
    if (!hydrated) return;
    const request = beginRequest();
    setLoading(true);
    try {
      setError('');
      const [projectRows, taskRows] = await Promise.all([
        api.listAll('projects', { active: true, department_id: departmentId || '' }, { signal: request.signal }),
        api.listAll('tasks', { active: true, department_id: departmentId || '' }, { signal: request.signal }),
      ]);
      if (!request.isCurrent()) return;
      setProjects(projectRows);
      setTasks(taskRows);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Projects could not be loaded.');
    } finally { if (request.isCurrent()) setLoading(false); }
  }, [beginRequest, departmentId, hydrated]);

  useEffect(() => { void load(); }, [load]);

  async function createProject() {
    if (!title.trim() || busy || !hydrated) return;
    setBusy(true);
    setError('');
    try {
      await api.create('projects', {
        title: title.trim(),
        department_id: departmentId || null,
        due_date: dueDate || null,
        priority,
        status: 'Planned',
        note: note.trim() || null,
      });
      setTitle(''); setDueDate(''); setPriority('Normal'); setNote(''); setShowAdd(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Project could not be created.');
    } finally {
      setBusy(false);
    }
  }

  const enriched = useMemo<EnrichedProject[]>(() => projects.map((project): EnrichedProject => {
    const linked = tasks.filter(task => Number(task.project_id) === Number(project.id));
    const done = linked.filter(task => task.status === 'Done').length;
    const overdue = linked.filter(task => task.status !== 'Done' && isOverduePropertyDay(task.due_date)).length;
    return { ...project, linked_tasks: linked, progress: linked.length ? Math.round((done / linked.length) * 100) : 0, overdue_tasks: overdue };
  }), [projects, tasks]);

  const searchParams = useSearchParams();
  const detailId = Number(searchParams.get('project'));
  useEffect(() => {
    if (!detailId || !hydrated) return;
    let active = true;
    async function openDetails() {
      try {
        const detail = await api.get('projects', detailId);
        const rows = await api.listAll('tasks', { active: true, department_id: detail.department_id || '' });
        const linked = rows.filter(t => Number(t.project_id) === detailId);
        if (active) setSelected({ ...detail, linked_tasks: linked, progress: linked.length ? Math.round(linked.filter(t => t.status === 'Done').length * 100 / linked.length) : 0, overdue_tasks: linked.filter(t => t.status !== 'Done' && isOverduePropertyDay(t.due_date)).length });
      } catch (err: any) { if (active) setError(err.message || 'Project could not be opened.'); }
    }
    void openDetails();
    return () => { active = false; };
  }, [detailId, hydrated]);

  const visible = filter === 'All' ? enriched : enriched.filter(project => project.status === filter);

  async function transition(action: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.workflowAction('projects', selected.id, action, { note: actionNote.trim() || null });
      setSelected({ ...selected, ...updated });
      setActionNote('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Project status could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function createLinkedTask() {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.workflowCreateTask('projects', selected.id, { department_id: selected.department_id || departmentId, note: taskNote.trim() || `Next action for project: ${selected.title}` });
      setTaskNote('');
      await load();
      const detail = await api.get('projects', selected.id);
      const linked = (await api.listAll('tasks', { active: true, department_id: selected.department_id || departmentId })).filter(task => Number(task.project_id) === Number(selected.id));
      setSelected({ ...selected, ...detail, linked_tasks: linked });
    } catch (err: any) {
      setError(err.message || 'Linked task could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile() {
    if (!selected || !file || busy) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      await api.attach('projects', selected.id, form);
      setFile(null);
      const detail = await api.get('projects', selected.id);
      setSelected({ ...selected, ...detail });
    } catch (err: any) {
      setError(err.message || 'Project file could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated || loading) return <><Top title="Projects" /><LoadingPanel label="Loading projects and progress…" /></>;

  return <div className="ops-module">
    <Top title="Projects" right={canManage ? <button data-testid="create-project" className="btn" onClick={() => setShowAdd(value => !value)}><Icon name="plus" />New project</button> : undefined} />
    <WorkspaceStats items={[
      { label: 'In progress', value: error ? null : enriched.filter(p => p.status === 'Active').length, icon: 'projects' },
      { label: 'Paused or overdue', value: error ? null : enriched.filter(p => p.overdue_tasks > 0 || p.status === 'Paused').length, icon: 'clock', attention: true },
      { label: 'Completed', value: error ? null : enriched.filter(p => p.status === 'Done').length, icon: 'check' },
    ]} />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {canManage && showAdd ? <section className="panel" style={{ marginBottom: 16 }} data-testid="create-project-form">
      <h2>Create project</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Project title<input className="input" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="label">Due date<input className="input" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
        <label className="label">Priority<select className="select" value={priority} onChange={event => setPriority(event.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
      </div>
      <label className="label">Notes<textarea className="textarea" value={note} onChange={event => setNote(event.target.value)} /></label>
      <div className="toolbar"><button className="btn" disabled={busy || !title.trim()} onClick={createProject}>{busy ? 'Saving…' : 'Create project'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <div className="ops-filter-bar"><Tabs values={['All', 'Planned', 'Active', 'Paused', 'Done']} active={filter} onChange={setFilter} label="Project status" /></div>
    <div className="ops-project-grid">
      {visible.map(project => <Link className="ops-project-card" key={project.id} href={`/projects/${project.id}`}>
        <span className={`ops-project-cover ${project.overdue_tasks ? 'ops-cover-sand' : ''}`}><span className="ops-project-emblem"><Icon name="projects" /></span><Pill value={project.status || 'Planned'} /><span className="ops-cover-lines" aria-hidden="true" /></span>
        <span className="ops-project-content"><span className="ops-project-kicker">{project.overdue_tasks ? `${project.overdue_tasks} overdue task${project.overdue_tasks === 1 ? '' : 's'}` : project.priority + ' priority'}</span><strong>{project.title}</strong>{project.note ? <span className="ops-work-card-description">{project.note}</span> : null}
        <span className="ops-progress-label"><span>{project.linked_tasks.filter((t: Entity) => t.status === 'Done').length} of {project.linked_tasks.length} tasks done</span><b>{project.progress}%</b></span>
        <span className="ops-progress-track" role="progressbar" aria-label={`${project.title} task completion`} aria-valuenow={project.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${project.progress}%` }} /></span>
        <span className="ops-work-card-footer"><span><Icon name="clock" />{project.due_date ? `Due ${formatDate(project.due_date)}` : 'No due date'}</span><Icon name="arrow" /></span></span>
      </Link>)}
    </div>
    {!visible.length ? <div className="empty"><Icon name="projects" />No projects in this view.</div> : null}
    <Drawer item={selected} title={selected?.title || 'Project'} showSupplemental={false} onClose={() => setSelected(null)}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}>

          <h2>{selected.overdue_tasks ? 'At risk' : selected.status === 'Paused' ? 'Paused' : 'On track'}</h2>
          <div className="card-line"><Pill value={`${selected.progress}% complete`} /><Pill value={`${selected.linked_tasks.length} tasks`} />{selected.overdue_tasks ? <Pill value={`${selected.overdue_tasks} overdue`} /> : null}</div>
          {(selected.allowed_actions || []).length ? <>
            <label className="label" style={{ marginTop: 14 }}>Action note<textarea className="textarea" value={actionNote} onChange={event => setActionNote(event.target.value)} placeholder="Required to pause or reopen" /></label>
            <div className="toolbar">
              {(selected.allowed_actions || []).map((action: string) => <button className={action === 'complete' ? 'btn' : 'btn secondary'} key={action} disabled={busy || (['pause', 'reopen'].includes(action) && !actionNote.trim())} onClick={() => transition(action)}>{({ start: 'Start project', pause: 'Pause', resume: 'Resume', complete: 'Complete', reopen: 'Reopen' } as Record<string, string>)[action] || action}</button>)}
            </div>
          </> : <p className="muted">No project transition is available for your role and this state.</p>}
        </section>
        <section className="panel">
          <h2>Linked tasks</h2>
          {canManage ? <div className="form" style={{ marginTop: 12 }}><textarea className="textarea" placeholder="Describe the next project action" value={taskNote} onChange={event => setTaskNote(event.target.value)} /><button className="btn secondary" disabled={busy} onClick={createLinkedTask}>Create linked task</button></div> : null}
          <div className="grid" style={{ marginTop: 12 }}>
            {selected.linked_tasks.map((task: Entity) => <div className="card" key={task.id}><strong>{task.title}</strong><div className="card-line"><Pill value={task.status} /><Pill value={task.priority || 'Normal'} /></div><span className="muted">Due {formatDate(task.due_date)}</span></div>)}
            {!selected.linked_tasks.length ? <div className="empty">No linked tasks yet.</div> : null}
          </div>
        </section>
        <Link className="btn" style={{ marginTop: 16 }} href={`/projects/${selected.id}`}>Discussion & purchase list</Link>
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Files & activity</h2>
          {canManage ? <div className="form" style={{ marginTop: 12 }}><input className="input" type="file" onChange={event => setFile(event.target.files?.[0] || null)} /><button className="btn secondary" disabled={busy || !file} onClick={uploadFile}>Upload project file</button></div> : null}
          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <div><h3>Files</h3><div className="grid">{(selected.attachments || []).map((item: Entity) => <button type="button" className="card" key={item.id} onClick={() => api.downloadAttachment(item.id, item.filename || 'project-file')}><strong>{item.filename || 'Project file'}</strong><span className="muted">Uploaded {formatDate(item.created_at)}</span></button>)}{!(selected.attachments || []).length ? <div className="empty">No files yet.</div> : null}</div></div>
            <div><h3>Activity</h3><div className="timeline">{(selected.activity || []).map((item: Entity) => <div className="timeline-item" key={item.id}><b>{String(item.action).replaceAll('_', ' ')}</b><span>{item.message}</span><small>{formatDate(item.created_at)}</small></div>)}{!(selected.activity || []).length ? <div className="empty">No activity yet.</div> : null}</div></div>
          </div>
        </section>
      </> : null}
    </Drawer>
  </div>;
}
