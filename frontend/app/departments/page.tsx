'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId } from '@/lib/session';
import styles from './departments.module.css';

const tabs = [
  ['Overview', 'overview'],
  ['Tasks', 'tasks'],
  ['Talk', 'talk'],
  ['Requests', 'requests'],
  ['Projects', 'projects'],
  ['Routine', 'routines'],
  ['Docs', 'docs'],
  ['People', 'people'],
  ['History', 'history'],
] as const;

const priorityRank: Record<string, number> = { urgent: 0, critical: 0, high: 1, normal: 2, medium: 2, low: 3 };
const terminalStatuses = ['done', 'completed', 'approved', 'verified', 'posted', 'rejected', 'cancelled', 'archived', 'expired', 'closed'];

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function titleFor(item: Entity) {
  return item.title || item.name || item.subject || item.summary || item.role || 'Untitled item';
}

function detailFor(item: Entity) {
  return item.note || item.description || item.body || item.summary || item.detail || item.email || '';
}

function ownerFor(item: Entity) {
  return item.owner?.name || item.assignee?.name || item.owner_name || item.assignee_name || '';
}

function dateFor(item: Entity) {
  const raw = item.due_at || item.due_date || item.starts_at || item.created_at || item.updated_at;
  if (!raw) return '';
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function destination(kind: string) {
  if (kind === 'Tasks') return '/tasks';
  if (kind === 'Requests') return '/requests';
  if (kind === 'Projects') return '/projects';
  if (kind === 'Talk' || kind === 'Shift') return '/shift';
  if (kind === 'History') return '/history';
  return '';
}

function isActive(item: Entity) {
  return !terminalStatuses.includes(text(item.status).toLowerCase());
}

function sortRows(rows: Entity[]) {
  return [...rows].sort((a, b) => {
    const aDone = isActive(a) ? 0 : 1;
    const bDone = isActive(b) ? 0 : 1;
    if (aDone !== bDone) return aDone - bDone;
    const aPriority = priorityRank[text(a.priority || a.urgency || 'normal').toLowerCase()] ?? 2;
    const bPriority = priorityRank[text(b.priority || b.urgency || 'normal').toLowerCase()] ?? 2;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
  });
}

function WorkspaceCard({ item, kind, compact = false }: { item: Entity; kind: string; compact?: boolean }) {
  const href = destination(kind);
  const detail = detailFor(item);
  const date = dateFor(item);
  const content = <>
    <div className={styles.cardHead}>
      <div className={styles.cardTitle}>{titleFor(item)}</div>
      {date ? <span>{date}</span> : null}
    </div>
    <div className={styles.cardMeta}>
      <Pill value={kind} />
      <Pill value={item.status || item.role || item.type} />
      <Pill value={item.priority || item.urgency} />
    </div>
    {!compact && detail ? <p>{text(detail).slice(0, 180)}</p> : null}
    {ownerFor(item) ? <small>Owner: {ownerFor(item)}</small> : null}
  </>;

  return href ? <Link className={styles.workspaceCard} href={href}>{content}</Link> : <div className={styles.workspaceCard}>{content}</div>;
}

function WorkspaceSection({ title, eyebrow, href, children }: { title: string; eyebrow: string; href?: string; children: React.ReactNode }) {
  return <section className={styles.surface}>
    <div className={styles.sectionHead}>
      <div><span>{eyebrow}</span><h2>{title}</h2></div>
      {href ? <Link className="btn small secondary" href={href}>View all</Link> : null}
    </div>
    {children}
  </section>;
}

export default function DepartmentsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [user, setUser] = useState<Entity | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [workspace, setWorkspace] = useState<Entity | null>(null);
  const [tab, setTab] = useState('Overview');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadWorkspace(id: number) {
    setLoading(true);
    setError('');
    try {
      setWorkspace(await api.departmentWorkspace(id));
    } catch (err: any) {
      setWorkspace(null);
      setError(err.message || 'Could not load this department workspace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = getStoredUser();
    setUser(stored);
    const queryDept = search.get('dept');
    const id = queryDept ? Number(queryDept) : getCurrentDepartmentId(stored);
    if (id) {
      setDeptId(id);
      setCurrentDepartmentId(id);
      loadWorkspace(id);
    } else {
      setLoading(false);
    }
  }, [search]);

  function switchDept(id: number) {
    setDeptId(id);
    setCurrentDepartmentId(id);
    setQuery('');
    setTab('Overview');
    router.push(`/departments?dept=${id}`);
  }

  const departments = user?.departments || [];
  const activeDept = workspace?.department;
  const counts = useMemo(() => Object.fromEntries(tabs.filter(([, source]) => source !== 'overview').map(([label, source]) => [label, (workspace?.[source] || []).length])), [workspace]);

  const activeTasks = useMemo(() => sortRows((workspace?.tasks || []).filter(isActive)), [workspace]);
  const urgentTasks = activeTasks.filter(item => ['urgent', 'critical', 'high'].includes(text(item.priority || item.urgency).toLowerCase()));
  const activeRequests = useMemo(() => sortRows((workspace?.requests || []).filter(isActive)), [workspace]);
  const activeProjects = useMemo(() => sortRows((workspace?.projects || []).filter(isActive)), [workspace]);
  const handover = useMemo(() => sortRows((workspace?.shift || workspace?.talk || []).filter(isActive)), [workspace]);
  const routines = useMemo(() => sortRows(workspace?.routines || []), [workspace]);
  const docs = useMemo(() => sortRows(workspace?.docs || []), [workspace]);
  const people: Entity[] = workspace?.people || [];

  const totalActive = activeTasks.length + activeRequests.length + activeProjects.length + handover.length;
  const pulse = urgentTasks.length ? 'Needs attention' : totalActive > 14 ? 'Busy' : 'Healthy';

  const key = tabs.find(([label]) => label === tab)?.[1] || 'tasks';
  const allRows: Entity[] = key === 'overview' ? [] : workspace?.[key] || [];
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(() => sortRows(allRows.filter(item => !normalizedQuery || [titleFor(item), detailFor(item), item.status, item.priority, item.urgency, item.role, item.email, ownerFor(item)].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery))), [allRows, normalizedQuery]);

  const emptyText = normalizedQuery ? 'No matching records' : tab === 'People' ? 'No people linked to this department yet' : tab === 'Docs' ? 'No documents or SOPs yet' : tab === 'History' ? 'No archived activity yet' : `No ${tab.toLowerCase()} yet`;

  return <>
    <Top
      eyebrow="Department workspace"
      title={activeDept?.name || 'Departments'}
      right={<div className="toolbar tight" style={{ marginBottom: 0 }}>
        {departments.length > 1 ? <select className="select" style={{ maxWidth: 220 }} value={deptId || ''} onChange={event => switchDept(Number(event.target.value))} disabled={loading}>{departments.map((department: Entity) => <option key={department.id} value={department.id}>{department.name}</option>)}</select> : null}
        <button className="btn secondary" onClick={() => deptId && loadWorkspace(deptId)} disabled={!deptId || loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>}
    />

    {error ? <div className="pill urgent" style={{ marginBottom: 14 }}>{error}</div> : null}

    <section className={styles.hero}>
      <div>
        <span className={styles.heroLabel}>Live department hub</span>
        <h2>{pulse === 'Healthy' ? 'The department is operating normally.' : `${urgentTasks.length || totalActive} items need coordination.`}</h2>
        <p>Work, handovers, projects, requests, routines, documents and people in one operational workspace.</p>
      </div>
      <div className={styles.quickActions}>
        <Link className="btn" href="/tasks">+ Task</Link>
        <Link className="btn secondary" href="/requests">+ Request</Link>
        <Link className="btn secondary" href="/shift">+ Handover</Link>
        <Link className="btn secondary" href="/projects">+ Project</Link>
      </div>
    </section>

    <div className={styles.metrics}>
      <div className={`${styles.metric} ${urgentTasks.length ? styles.urgent : styles.ok}`}><span>Department pulse</span><strong>{pulse}</strong><small>{urgentTasks.length} urgent or high-priority</small></div>
      <div className={styles.metric}><span>Active work</span><strong>{totalActive}</strong><small>Across tasks, projects, requests and handover</small></div>
      <div className={styles.metric}><span>People</span><strong>{people.length}</strong><small>Linked operational identities</small></div>
      <div className={styles.metric}><span>Knowledge</span><strong>{routines.length + docs.length}</strong><small>Routines and department documents</small></div>
    </div>

    <div className={styles.tabs}>
      {tabs.map(([label]) => <button className={`${styles.tab} ${tab === label ? styles.activeTab : ''}`} key={label} onClick={() => { setTab(label); setQuery(''); }} disabled={loading}>{label}{label !== 'Overview' ? <span>{counts[label] || 0}</span> : null}</button>)}
    </div>

    {loading ? <div className="panel"><div className="empty">Loading department workspace…</div></div> : tab === 'Overview' ? <div className={styles.workspaceGrid}>
      <WorkspaceSection title="Needs attention" eyebrow="Priority work" href="/tasks">
        <div className={styles.stack}>{urgentTasks.length ? urgentTasks.slice(0, 4).map((item, index) => <WorkspaceCard key={`urgent-${item.id || index}`} item={item} kind="Tasks" compact />) : <div className={styles.clearState}><strong>All clear</strong><span>No urgent department work.</span></div>}</div>
      </WorkspaceSection>

      <WorkspaceSection title="Shift handover" eyebrow="Continuity" href="/shift">
        <div className={styles.stack}>{handover.length ? handover.slice(0, 4).map((item, index) => <WorkspaceCard key={`shift-${item.id || index}`} item={item} kind="Shift" compact />) : <div className="empty">No open handover notes.</div>}</div>
      </WorkspaceSection>

      <WorkspaceSection title="Active projects" eyebrow="Execution" href="/projects">
        <div className={styles.stack}>{activeProjects.length ? activeProjects.slice(0, 4).map((item, index) => <WorkspaceCard key={`project-${item.id || index}`} item={item} kind="Projects" compact />) : <div className="empty">No active projects.</div>}</div>
      </WorkspaceSection>

      <WorkspaceSection title="Requests & decisions" eyebrow="Coordination" href="/requests">
        <div className={styles.stack}>{activeRequests.length ? activeRequests.slice(0, 4).map((item, index) => <WorkspaceCard key={`request-${item.id || index}`} item={item} kind="Requests" compact />) : <div className="empty">No active requests.</div>}</div>
      </WorkspaceSection>

      <WorkspaceSection title="Recurring work" eyebrow="Operating rhythm">
        <div className={styles.stack}>{routines.length ? routines.slice(0, 4).map((item, index) => <WorkspaceCard key={`routine-${item.id || index}`} item={item} kind="Routine" compact />) : <div className="empty">No recurring work templates yet.</div>}</div>
      </WorkspaceSection>

      <WorkspaceSection title="Docs & SOPs" eyebrow="Department knowledge">
        <div className={styles.stack}>{docs.length ? docs.slice(0, 4).map((item, index) => <WorkspaceCard key={`doc-${item.id || index}`} item={item} kind="Docs" compact />) : <div className="empty">No department documents yet.</div>}</div>
      </WorkspaceSection>

      <WorkspaceSection title="People & roles" eyebrow="Accountability">
        <div className={styles.peopleGrid}>{people.length ? people.slice(0, 8).map((person, index) => <div className={styles.person} key={person.id || index}><div>{text(person.name).slice(0, 1).toUpperCase()}</div><span><strong>{person.name || 'Team member'}</strong><small>{person.role || person.email || 'Department member'}</small></span></div>) : <div className="empty">No linked people.</div>}</div>
      </WorkspaceSection>
    </div> : <>
      <div className={styles.browserToolbar}>
        <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${tab.toLowerCase()} by title, owner, status, or details`} />
        {normalizedQuery ? <button className="btn secondary" onClick={() => setQuery('')}>Clear</button> : null}
      </div>
      <div className={styles.browserHeader}><div><b>{tab}</b><span>{rows.length} shown</span></div>{destination(tab) ? <Link className="btn small secondary" href={destination(tab)}>Open full module</Link> : null}</div>
      <div className={styles.recordGrid}>{rows.length ? rows.map((item, index) => <WorkspaceCard key={`${tab}-${item.id || index}`} item={item} kind={tab} />) : <div className="empty">{emptyText}</div>}</div>
    </>}
  </>;
}
