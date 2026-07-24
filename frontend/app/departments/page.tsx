'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

const tabs = [
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

function text(value: any) {
  return value === undefined || value === null ? '' : String(value);
}

function titleFor(item: Entity) {
  return item.title || item.name || item.subject || item.summary || item.role || 'Untitled item';
}

function detailFor(item: Entity) {
  return item.note || item.description || item.body || item.summary || item.detail || item.email || '';
}

function dateFor(item: Entity) {
  const raw = item.due_at || item.starts_at || item.created_at || item.updated_at;
  if (!raw) return '';
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function destination(tab: string) {
  if (tab === 'Tasks') return '/tasks';
  if (tab === 'Requests') return '/requests';
  if (tab === 'Projects') return '/projects';
  if (tab === 'Talk') return '/shift';
  if (tab === 'History') return '/history';
  return '';
}

function WorkspaceCard({ item, kind }: { item: Entity; kind: string }) {
  const href = destination(kind);
  const detail = detailFor(item);
  const date = dateFor(item);
  const content = <>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div className="card-title">{titleFor(item)}</div>
      {date ? <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{date}</span> : null}
    </div>
    <div className="card-line">
      <Pill value={kind} />
      <Pill value={item.status || item.role || item.type} />
      <Pill value={item.priority || item.urgency} />
    </div>
    {detail ? <div className="muted" style={{ lineHeight: 1.55 }}>{text(detail).slice(0, 170)}</div> : null}
    {item.owner?.name || item.assignee?.name || item.owner_name || item.assignee_name ? <div className="muted" style={{ fontSize: 12 }}>Owner: {item.owner?.name || item.assignee?.name || item.owner_name || item.assignee_name}</div> : null}
  </>;

  return href ? <Link className="card row-card" href={href}>{content}</Link> : <div className="card">{content}</div>;
}

export default function DepartmentsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [user, setUser] = useState<Entity | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [workspace, setWorkspace] = useState<Entity | null>(null);
  const [tab, setTab] = useState('Tasks');
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
    router.push(`/departments?dept=${id}`);
  }

  const departments = user?.departments || [];
  const activeDept = workspace?.department;
  const key = tabs.find(([label]) => label === tab)?.[1] || 'tasks';
  const allRows: Entity[] = workspace?.[key] || [];
  const normalizedQuery = query.trim().toLowerCase();

  const counts = useMemo(() => Object.fromEntries(tabs.map(([label, source]) => [label, (workspace?.[source] || []).length])), [workspace]);

  const activeRows = useMemo(() => allRows.filter(item => !terminalStatuses.includes(text(item.status).toLowerCase())), [allRows]);
  const urgentRows = useMemo(() => activeRows.filter(item => ['urgent', 'critical', 'high'].includes(text(item.priority || item.urgency).toLowerCase())), [activeRows]);

  const rows = useMemo(() => allRows
    .filter(item => !normalizedQuery || [titleFor(item), detailFor(item), item.status, item.priority, item.urgency, item.role, item.email].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      const aDone = terminalStatuses.includes(text(a.status).toLowerCase()) ? 1 : 0;
      const bDone = terminalStatuses.includes(text(b.status).toLowerCase()) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const aPriority = priorityRank[text(a.priority || a.urgency || 'normal').toLowerCase()] ?? 2;
      const bPriority = priorityRank[text(b.priority || b.urgency || 'normal').toLowerCase()] ?? 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aDate = new Date(a.due_at || a.starts_at || a.updated_at || a.created_at || 0).getTime();
      const bDate = new Date(b.due_at || b.starts_at || b.updated_at || b.created_at || 0).getTime();
      return bDate - aDate;
    }), [allRows, normalizedQuery]);

  const pulse = urgentRows.length ? 'Needs attention' : activeRows.length > 8 ? 'Busy' : 'Healthy';
  const emptyText = normalizedQuery ? 'No matching records' : tab === 'People' ? 'No people linked to this department yet' : tab === 'Docs' ? 'No documents or SOPs yet' : tab === 'History' ? 'No archived activity yet' : `No active ${tab.toLowerCase()} yet`;

  return <>
    <Top
      eyebrow="Workspace"
      title={activeDept?.name || 'Departments'}
      right={<div className="toolbar tight" style={{ marginBottom: 0 }}>
        {departments.length > 1 ? <select className="select" style={{ maxWidth: 220 }} value={deptId || ''} onChange={event => switchDept(Number(event.target.value))} disabled={loading}>{departments.map((department: Entity) => <option key={department.id} value={department.id}>{department.name}</option>)}</select> : null}
        <button className="btn secondary" onClick={() => deptId && loadWorkspace(deptId)} disabled={!deptId || loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>}
    />

    {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}

    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="stat"><span className="muted">Department pulse</span><b>{pulse}</b><small className="muted">{urgentRows.length} urgent or high-priority</small></div>
      <div className="stat"><span className="muted">Active work</span><b>{activeRows.length}</b><small className="muted">Across the selected view</small></div>
      <div className="stat"><span className="muted">People</span><b>{counts.People || 0}</b><small className="muted">Linked operational identities</small></div>
    </div>

    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="card-line">
        <Pill value={departments.length > 1 ? 'Multi-dept' : 'Primary'} />
        <Pill value={user?.role} />
        <Pill value={pulse} />
        <span className="muted">Active work first. Completed records remain available in History.</span>
      </div>
    </div>

    <div className="command-band">
      <Link className="btn" href="/tasks">Create or assign task</Link>
      <Link className="btn secondary" href="/requests">New request</Link>
      <Link className="btn secondary" href="/shift">Add handover note</Link>
      <Link className="btn secondary" href="/review">Open review queue</Link>
    </div>

    <div className="panel" style={{ marginBottom: 16 }}>
      <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${tab.toLowerCase()} by title, owner, status, or details`} />
    </div>

    <div className="tabs" style={{ overflowX: 'auto' }}>
      {tabs.map(([label]) => <button className={`tab ${tab === label ? 'active' : ''}`} key={label} onClick={() => { setTab(label); setQuery(''); }} disabled={loading}>{label} <span className="muted">{counts[label] || 0}</span></button>)}
    </div>

    {loading ? <div className="panel"><div className="empty">Loading department workspace…</div></div> : <>
      <div className="card-line" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div><b>{tab}</b> <span className="muted">· {rows.length} shown</span></div>
        {normalizedQuery ? <button className="btn small secondary" onClick={() => setQuery('')}>Clear search</button> : null}
      </div>
      <div className="grid cols-3">
        {rows.length ? rows.map((item: Entity, index: number) => <WorkspaceCard key={`${tab}-${item.id || index}`} item={item} kind={tab} />) : <div className="empty">{emptyText}</div>}
      </div>
    </>}
  </>;
}
