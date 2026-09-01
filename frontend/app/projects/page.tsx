'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Drawer } from '@/components/Drawer';
import { Tabs } from '@/components/Tabs';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
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
  const [filter, setFilter] = useState('Active');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [note, setNote] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [comment, setComment] = useState('');
  const [commentType, setCommentType] = useState('Update');
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
    const overdue = linked.filter(task => task.due_date && task.status !== 'Done' && new Date(task.due_date).getTime() < Date.now()).length;
    return { ...project, linked_tasks: linked, progress: linked.length ? Math.round((done / linked.length) * 100) : 0, overdue_tasks: overdue };
  }), [projects, tasks]);

  const visible = filter === 'All' ? enriched : enriched.filter(project => project.status === filter);

  async function openProject(project: EnrichedProject) {
    try {
      const detail = await api.get('projects', project.id);
      setSelected({ ...project, ...detail });
      setActionNote('');
      setComment('');
    } catch (err: any) {
      setError(err.message || 'Project could not be opened.');
    }
  }

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

  async function addComment() {
    if (!selected || !comment.trim() || busy) return;
    setBusy(true);
    try {
      await api.comment('projects', selected.id, comment.trim(), commentType);
      const detail = await api.get('projects', selected.id);
      setSelected({ ...selected, ...detail });
      setComment('');
    } catch (err: any) {
      setError(err.message || 'Project update could not be added.');
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

  if (!hydrated || loading) return <><Top eyebrow="Delivery portfolio" title="Projects" /><LoadingPanel label="Loading projects and progress…" /></>;

  return <>
    <Top eyebrow="Delivery portfolio" title="Projects" right={canManage ? <button data-testid="create-project" className="btn" onClick={() => setShowAdd(value => !value)}>New project</button> : undefined} />
    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="panel"><div className="eyebrow">Active</div><h2>{enriched.filter(project => project.status === 'Active').length}</h2></div>
      <div className="panel"><div className="eyebrow">At risk</div><h2>{enriched.filter(project => project.overdue_tasks > 0 || project.status === 'Paused').length}</h2></div>
      <div className="panel"><div className="eyebrow">Completed</div><h2>{enriched.filter(project => project.status === 'Done').length}</h2></div>
    </div>
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
    <Tabs values={['All', 'Planned', 'Active', 'Paused', 'Done']} active={filter} onChange={setFilter} label="Project status" />
    <div className="grid cols-3">
      {visible.map(project => <button type="button" className={`card ${project.overdue_tasks ? 'card-important' : ''}`} key={project.id} onClick={() => openProject(project)} style={{ textAlign: 'left' }}>
        <strong className="card-title">{project.title}</strong>
        <span className="card-line"><Pill value={project.status} /><Pill value={project.priority || 'Normal'} />{project.overdue_tasks ? <Pill value={`${project.overdue_tasks} overdue`} /> : null}</span>
        <span className="muted">Due {formatDate(project.due_date)}</span>
        <span className="muted">{project.linked_tasks.length} linked tasks · {project.progress}% complete</span>
        <span aria-label={`${project.progress}% complete`} style={{ display: 'block', height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}><span style={{ display: 'block', width: `${project.progress}%`, height: '100%', background: 'var(--accent)' }} /></span>
      </button>)}
      {!visible.length ? <div className="empty">No projects in this view.</div> : null}
    </div>
    <Drawer item={selected} title="Project" onClose={() => setSelected(null)}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Delivery health</div>
          <h2>{selected.overdue_tasks ? 'At risk' : selected.status === 'Paused' ? 'Paused' : 'On track'}</h2>
          <div className="card-line"><Pill value={`${selected.progress}% complete`} /><Pill value={`${selected.linked_tasks.length} tasks`} />{selected.overdue_tasks ? <Pill value={`${selected.overdue_tasks} overdue`} /> : null}</div>
          {(selected.allowed_actions || []).length ? <>
            <label className="label" style={{ marginTop: 14 }}>Action note<textarea className="textarea" value={actionNote} onChange={event => setActionNote(event.target.value)} placeholder="Required for pause or reopen; useful for the audit trail" /></label>
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
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Project discussion</h2>
          <div className="form" style={{ marginTop: 12 }}><select className="select" aria-label="Discussion type" value={commentType} onChange={event => setCommentType(event.target.value)}>{['Update', 'Question', 'Decision', 'Risk', 'Blocker'].map(value => <option key={value}>{value}</option>)}</select><textarea className="textarea" placeholder="Add context that stays attached to this project" value={comment} onChange={event => setComment(event.target.value)} /><button className="btn secondary" disabled={busy || !comment.trim()} onClick={addComment}>Add {commentType.toLowerCase()}</button></div>
          <p className="muted">Mention a teammate as <code>@[Full Name]</code> or with their email address to notify them.</p>
          <div className="grid" style={{ marginTop: 12 }}>{(selected.comments || []).map((item: Entity) => <div className="card" key={item.id}><div className="card-line"><Pill value={item.comment_type || 'Update'} />{item.author_name ? <span className="muted">{item.author_name}</span> : null}</div><span>{item.body}</span><span className="muted">{formatDate(item.created_at)}</span></div>)}{!(selected.comments || []).length ? <div className="empty">No project discussion yet.</div> : null}</div>
        </section>
        <section className="panel" style={{ marginTop: 16 }}>
          <h2>Files & activity</h2>
          {canManage ? <div className="form" style={{ marginTop: 12 }}><input className="input" type="file" onChange={event => setFile(event.target.files?.[0] || null)} /><button className="btn secondary" disabled={busy || !file} onClick={uploadFile}>Upload project file</button></div> : null}
          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <div><h3>Files</h3><div className="grid">{(selected.attachments || []).map((item: Entity) => <button type="button" className="card" key={item.id} onClick={() => api.downloadAttachment(item.id, item.filename || 'project-file')}><strong>{item.filename || 'Project file'}</strong><span className="muted">Uploaded {formatDate(item.created_at)}</span></button>)}{!(selected.attachments || []).length ? <div className="empty">No files yet.</div> : null}</div></div>
            <div><h3>Activity</h3><div className="timeline">{(selected.activity || []).map((item: Entity) => <div className="timeline-item" key={item.id}><b>{item.action}</b><span>{item.message}</span><small>{formatDate(item.created_at)}</small></div>)}{!(selected.activity || []).length ? <div className="empty">No activity yet.</div> : null}</div></div>
          </div>
        </section>
      </> : null}
    </Drawer>
  </>;
}
