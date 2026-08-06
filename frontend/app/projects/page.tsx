'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Drawer } from '@/components/Drawer';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';

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
  const [error, setError] = useState('');
  const departmentId = getCurrentDepartmentId(getStoredUser());

  async function load() {
    try {
      setError('');
      const [projectRows, taskRows] = await Promise.all([
        api.list('projects', { active: true, department_id: departmentId || '' }),
        api.list('tasks', { active: true, department_id: departmentId || '' }),
      ]);
      setProjects(projectRows);
      setTasks(taskRows);
    } catch (err: any) {
      setError(err.message || 'Projects could not be loaded.');
    }
  }

  useEffect(() => { load(); }, []);

  const enriched = useMemo<EnrichedProject[]>(() => projects.map((project): EnrichedProject => {
    const linked = tasks.filter(task => Number(task.project_id) === Number(project.id));
    const done = linked.filter(task => task.status === 'Done').length;
    const overdue = linked.filter(task => task.due_date && task.status !== 'Done' && new Date(task.due_date).getTime() < Date.now()).length;
    return { ...project, linked_tasks: linked, progress: linked.length ? Math.round((done / linked.length) * 100) : 0, overdue_tasks: overdue };
  }), [projects, tasks]);

  const visible = filter === 'All' ? enriched : enriched.filter(project => project.status === filter);

  return <>
    <Top eyebrow="Delivery portfolio" title="Projects" />
    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="panel"><div className="eyebrow">Active</div><h2>{enriched.filter(project => project.status === 'Active').length}</h2></div>
      <div className="panel"><div className="eyebrow">At risk</div><h2>{enriched.filter(project => project.overdue_tasks > 0 || project.status === 'Paused').length}</h2></div>
      <div className="panel"><div className="eyebrow">Completed</div><h2>{enriched.filter(project => project.status === 'Done').length}</h2></div>
    </div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="tabs" style={{ marginBottom: 16 }}>{['All', 'Planned', 'Active', 'Paused', 'Done'].map(status => <button key={status} className={`tab ${filter === status ? 'active' : ''}`} onClick={() => setFilter(status)}>{status}</button>)}</div>
    <div className="grid cols-3">
      {visible.map(project => <button type="button" className={`card ${project.overdue_tasks ? 'card-important' : ''}`} key={project.id} onClick={() => setSelected(project)} style={{ textAlign: 'left' }}>
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
        </section>
        <section className="panel">
          <h2>Linked tasks</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {selected.linked_tasks.map((task: Entity) => <div className="card" key={task.id}><strong>{task.title}</strong><div className="card-line"><Pill value={task.status} /><Pill value={task.priority || 'Normal'} /></div><span className="muted">Due {formatDate(task.due_date)}</span></div>)}
            {!selected.linked_tasks.length ? <div className="empty">No linked tasks yet.</div> : null}
          </div>
        </section>
      </> : null}
    </Drawer>
  </>;
}
