'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { Icon, IconName } from '@/components/Icon';
import { WorkspaceStats } from '@/components/WorkspaceStats';
import { useLatestRequest } from '@/lib/operation-hooks';
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
] as const;

const priorityRank: Record<string, number> = { urgent: 0, critical: 0, high: 1, normal: 2, medium: 2, low: 3 };
const terminalStatuses = ['done', 'completed', 'approved', 'verified', 'posted', 'rejected', 'cancelled', 'archived', 'expired', 'closed'];

function text(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function titleFor(item: Entity) {
  return item.title || item.name || item.subject || item.summary || item.role || item.message_type || 'Update';
}

function detailFor(item: Entity) {
  return item.note || item.description || item.body || item.summary || item.detail || item.reason || item.checklist || item.email || '';
}

function ownerFor(item: Entity) {
  return item.owner?.name || item.assignee?.name || item.owner_name || item.assignee_name || item.assigned_to?.name || '';
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
  const icons: Record<string, IconName> = { Tasks: 'tasks', Projects: 'projects', Requests: 'request', Shift: 'shift', Talk: 'shift', Docs: 'review', Routine: 'check', People: 'guests' };
  const content = <><span className={styles.recordIcon}><Icon name={icons[kind] || 'history'} /></span><div className={styles.recordBody}>
    <div className={styles.cardHead}>
      <div className={styles.cardTitle}>{titleFor(item)}</div>
      {date ? <span>{date}</span> : null}
    </div>
    <div className={styles.cardMeta}>
      <Pill value={item.status || item.role || item.type} />
      <Pill value={item.priority || item.urgency} />
    </div>
    {detail ? <p className={compact ? styles.compactDetail : undefined}>{compact ? text(detail).slice(0, 180) : text(detail)}</p> : null}
    {ownerFor(item) ? <small>{ownerFor(item)}</small> : null}
  </div></>;

  return href ? <Link className={styles.workspaceCard} href={href}>{content}</Link> : <div className={styles.workspaceCard}>{content}</div>;
}

function WorkspaceSection({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return <section className={styles.surface}>
    <div className={styles.sectionHead}>
      <div><h2>{title}</h2></div>
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

  const beginRequest = useLatestRequest();
  const loadWorkspace = useCallback(async (id: number) => {
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const result = await api.departmentWorkspace(id);
      if (!request.isCurrent()) return;
      const names = new Map((result.people || []).map((person: Entity) => [person.id, person.name]));
      for (const key of ['tasks', 'requests', 'projects', 'routines', 'shift']) {
        result[key] = (result[key] || []).map((item: Entity) => ({ ...item, owner_name: names.get(item.assigned_to_id || item.owner_id || item.submitted_by_id) || item.owner_name }));
      }
      setWorkspace(result);
    } catch (err: any) {
      if (!request.isCurrent()) return;
      setWorkspace(null);
      setError(err.message || 'Could not load this department workspace.');
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [beginRequest]);

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
  }, [search, loadWorkspace]);

  function switchDept(id: number) {
    setDeptId(id);
    setQuery('');
    setTab('Overview');
    router.push(`/departments?dept=${id}`);
  }

  const departments = user?.departments || [];
  const activeDept = workspace?.department;
  const counts = useMemo(() => Object.fromEntries(tabs.filter(([, source]) => source !== 'overview').map(([label, source]) => [label, workspace?.aggregate_counts?.[source] ?? (workspace?.[source] || []).length])), [workspace]);

  const activeTasks = useMemo(() => sortRows((workspace?.tasks || []).filter(isActive)), [workspace]);
  const urgentTasks = activeTasks.filter(item => ['urgent', 'critical', 'high'].includes(text(item.priority || item.urgency).toLowerCase()));
  const activeRequests = useMemo(() => sortRows((workspace?.requests || []).filter(isActive)), [workspace]);
  const activeProjects = useMemo(() => sortRows((workspace?.projects || []).filter(isActive)), [workspace]);
  const handover = useMemo(() => sortRows((workspace?.shift || workspace?.talk || []).filter(isActive)), [workspace]);
  const routines = useMemo(() => sortRows(workspace?.routines || []), [workspace]);
  const docs = useMemo(() => sortRows(workspace?.docs || []), [workspace]);
  const people: Entity[] = workspace?.people || [];

  const urgentTaskCount = urgentTasks.length;
  const key = tabs.find(([label]) => label === tab)?.[1] || 'tasks';
  const allRows = useMemo<Entity[]>(() => key === 'overview' ? [] : workspace?.[key] || [], [key, workspace]);
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(() => sortRows(allRows.filter(item => !normalizedQuery || [titleFor(item), detailFor(item), item.status, item.priority, item.urgency, item.role, item.email, ownerFor(item)].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery))), [allRows, normalizedQuery]);

  const emptyText = normalizedQuery ? 'No matching records' : tab === 'People' ? 'No people linked to this department yet' : tab === 'Docs' ? 'No documents or SOPs yet' : tab === 'History' ? 'No archived activity yet' : `No ${tab.toLowerCase()} yet`;

  return <div className={styles.departmentPage} aria-busy={loading}>
    <Top title="Departments" right={<button className="ops-icon-button" aria-label="Refresh department" onClick={() => deptId && loadWorkspace(deptId)} disabled={!deptId || loading}><Icon name="refresh" /></button>} />
    <nav className={styles.departmentPicker} aria-label="Choose department">{departments.map((department: Entity) => <button key={department.id} aria-pressed={deptId === department.id} onClick={() => switchDept(department.id)}><span>{({ Management: 'MG', Maintenance: 'MT', Marketing: 'MK' } as Record<string, string>)[department.name] || text(department.name).slice(0, 2).toUpperCase()}</span>{department.name}</button>)}</nav>
    <section className={styles.hero}>
      <div className={styles.departmentIdentity}><span className={styles.departmentEmblem}><Icon name="guests" /></span><div><h2>{loading ? 'Opening workspace…' : activeDept?.name || 'Choose a department'}</h2><p>{loading ? 'Loading…' : error ? 'This workspace could not be loaded.' : `${people.length} people`}</p></div></div>
      <div className={styles.quickActions}><Link className="btn" href="/tasks?create=1"><Icon name="plus" />New task</Link><Link className="btn secondary" href="/shift?create=1"><Icon name="shift" />Handover</Link></div>
    </section>
    {error ? <div className="today-error" role="alert">{error}</div> : null}
    <WorkspaceStats items={[
      { label: 'Tasks', value: loading || error ? null : counts.Tasks || 0, detail: loading ? 'Loading…' : `${urgentTaskCount} high-priority open task${urgentTaskCount === 1 ? '' : 's'}`, icon: 'tasks', attention: true },
      { label: 'Requests', value: loading || error ? null : counts.Requests || 0, icon: 'request' },
      { label: 'Projects', value: loading || error ? null : counts.Projects || 0, icon: 'projects' },
    ]} />
    <div className={styles.tabs} aria-label="Department sections">
      {tabs.map(([label]) => <button aria-pressed={tab === label} className={`${styles.tab} ${tab === label ? styles.activeTab : ''}`} key={label} onClick={() => { setTab(label); setQuery(''); }} disabled={loading}>{label}{label !== 'Overview' ? <span>{counts[label] || 0}</span> : null}</button>)}<Link className={styles.tab} href="/history">History <Icon name="external" width="13" height="13" /></Link>
    </div>
    {loading ? <div className="empty" role="status"><Icon name="refresh" />Loading department workspace…</div> : error ? null : !workspace ? <div className="empty">Choose a department to see its work.</div> : tab === 'Overview' ? <div className={styles.workspaceGrid}>
      <div className={styles.mainColumn}>
        <WorkspaceSection title="Open tasks" href="/tasks"><div className={styles.stack}>{activeTasks.length ? activeTasks.slice(0, 4).map(item => <WorkspaceCard key={item.id} item={item} kind="Tasks" compact />) : <div className={styles.clearState}><Icon name="check" /><strong>No open tasks</strong></div>}</div></WorkspaceSection>
        <WorkspaceSection title="Projects" href="/projects"><div className={styles.stack}>{activeProjects.length ? activeProjects.slice(0, 3).map(item => <WorkspaceCard key={item.id} item={item} kind="Projects" compact />) : <div className="empty">No active projects.</div>}</div></WorkspaceSection>
        <WorkspaceSection title="Requests" href="/requests"><div className={styles.stack}>{activeRequests.length ? activeRequests.slice(0, 3).map(item => <WorkspaceCard key={item.id} item={item} kind="Requests" compact />) : <div className="empty">No active requests.</div>}</div></WorkspaceSection>
      </div>
      <div className={styles.sideColumn}>
        <WorkspaceSection title="Shift handover" href="/shift"><div className={styles.stack}>{handover.length ? handover.slice(0, 3).map(item => <WorkspaceCard key={item.id} item={item} kind="Shift" compact />) : <div className="empty">No open handover notes.</div>}</div></WorkspaceSection>
        <WorkspaceSection title="Your team"><div className={styles.peopleGrid}>{people.length ? people.slice(0, 6).map(person => <div className={styles.person} key={person.id}><div>{text(person.name).split(' ').map(word => word[0]).slice(0, 2).join('').toUpperCase()}</div><span><strong>{person.name}</strong><small>{person.role || 'Team member'}</small></span></div>) : <div className="empty">No linked people.</div>}</div>{people.length > 6 ? <button className={styles.textButton} onClick={() => setTab('People')}>View all {people.length} people <Icon name="arrow" /></button> : null}</WorkspaceSection>
        <section className={styles.resources}><h2>Team essentials</h2><button onClick={() => setTab('Routine')}><span className={styles.resourceIcon}><Icon name="check" /></span><span><strong>Routines</strong><small>{routines.length} recurring checklists</small></span><Icon name="arrow" /></button><button onClick={() => setTab('Docs')}><span className={styles.resourceIcon}><Icon name="review" /></span><span><strong>Docs & guides</strong><small>{docs.length} team resources</small></span><Icon name="arrow" /></button></section>
      </div>
    </div> : <>
      <div className={styles.browserToolbar}><input className="input" aria-label={`Search ${tab.toLowerCase()}`} value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${tab.toLowerCase()}…`} />{normalizedQuery ? <button className="btn secondary" onClick={() => setQuery('')}>Clear</button> : null}</div>
      <div className={styles.browserHeader}><div><b>{tab}</b><span>{rows.length} shown</span></div>{destination(tab) ? <Link className="btn small secondary" href={destination(tab)}>View all <Icon name="arrow" /></Link> : null}</div>
      <div className={styles.recordGrid}>{rows.length ? rows.map((item, index) => <WorkspaceCard key={`${tab}-${item.id || index}`} item={item} kind={tab} />) : <div className="empty">{emptyText}</div>}</div>
    </>}
  </div>;
}
