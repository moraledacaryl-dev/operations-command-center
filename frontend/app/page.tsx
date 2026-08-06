'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';

function count(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roleCopy(role: string) {
  if (['owner', 'admin'].includes(role)) return { eyebrow: 'Property command view', summary: 'Cross-department exceptions, decisions, and connected-app risk.' };
  if (role === 'manager') return { eyebrow: 'Management view', summary: 'Team execution, pending decisions, and operational exceptions.' };
  if (['lead', 'supervisor'].includes(role)) return { eyebrow: 'Department lead view', summary: 'Assigned work, current handover, and department escalations.' };
  return { eyebrow: 'Personal work view', summary: 'Your assigned work, requests, and current shift actions.' };
}

function Metric({ label, value, detail, href, urgent = false }: { label: string; value: number; detail: string; href: string; urgent?: boolean }) {
  return (
    <Link className={`panel ${urgent && value ? 'card-important' : ''}`} href={href} style={{ display: 'grid', gap: 6 }}>
      <span className="eyebrow">{label}</span>
      <strong style={{ fontSize: 28 }}>{value}</strong>
      <span className="muted">{detail}</span>
    </Link>
  );
}

function WorkList({ title, eyebrow, items, href, empty }: { title: string; eyebrow: string; items: Entity[]; href: string; empty: string }) {
  return (
    <section className="panel">
      <div className="topbar" style={{ marginBottom: 12 }}>
        <div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>
        <Link className="btn small secondary" href={href}>Open</Link>
      </div>
      <div className="grid">
        {items.length ? items.slice(0, 4).map((item, index) => (
          <Link className="card" href={href} key={item.id || index}>
            <strong>{item.title || item.name || item.summary || 'Operational item'}</strong>
            <div className="card-line">
              {item.status || item.review_status ? <Pill value={item.status || item.review_status} /> : null}
              {item.priority || item.urgency ? <Pill value={item.priority || item.urgency} /> : null}
              {item.department_name ? <Pill value={item.department_name} /> : null}
            </div>
          </Link>
        )) : <div className="empty">{empty}</div>}
      </div>
    </section>
  );
}

export default function Home() {
  const [dashboard, setDashboard] = useState<Entity>({});
  const [myWork, setMyWork] = useState<Entity>({});
  const [integrations, setIntegrations] = useState<Entity>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const user = getStoredUser();
  const role = String(user?.role || 'staff').toLowerCase();
  const copy = roleCopy(role);
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0];
  const isExecutive = ['owner', 'admin', 'manager'].includes(role);
  const isLead = ['lead', 'supervisor'].includes(role);

  async function load() {
    setLoading(true);
    setError('');
    const [dashboardResult, workResult, integrationResult] = await Promise.allSettled([
      api.dashboard({ department_id: getCurrentDepartmentId(getStoredUser()) }),
      api.list('my-work'),
      isExecutive ? api.integrationOverview() : Promise.resolve({}),
    ]);
    if (dashboardResult.status === 'fulfilled') setDashboard(dashboardResult.value);
    else setError(dashboardResult.reason?.message || 'Today could not be loaded.');
    if (workResult.status === 'fulfilled') setMyWork(workResult.value as unknown as Entity);
    if (integrationResult.status === 'fulfilled') setIntegrations(integrationResult.value);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const counts = dashboard.counts || {};
  const groups = myWork.groups || {};
  const overdueCount = (groups.overdue || []).length;
  const attention = useMemo(() => {
    const rows: Entity[] = [];
    if (overdueCount) rows.push({ title: `${overdueCount} assigned task${overdueCount === 1 ? '' : 's'} overdue`, status: 'Overdue', priority: 'Urgent' });
    if (count(counts.approve)) rows.push({ title: `${counts.approve} decision${count(counts.approve) === 1 ? '' : 's'} waiting`, status: 'Pending', priority: 'High' });
    if (count(counts.fixes)) rows.push({ title: `${counts.fixes} maintenance item${count(counts.fixes) === 1 ? '' : 's'} open`, status: 'Open', priority: 'Normal' });
    return rows;
  }, [counts, overdueCount]);

  const personalRows = [
    ...(groups.overdue || []),
    ...(groups.today || []),
    ...(groups.waiting || []),
    ...(groups.upcoming || []),
  ].slice(0, 4);
  const handover = (dashboard.previous_shift || []).slice(0, 4);
  const approvals = (dashboard.approvals || []).slice(0, 4);
  const integrationAlerts = isExecutive
    ? Object.entries(integrations).filter(([, value]) => value && typeof value === 'object').slice(0, 4).map(([source, value]) => {
        const sourceValues = Object.values(value as Record<string, unknown>);
        const total = sourceValues.reduce((sum, item) => sum + count(item), 0);
        return { title: source, summary: `${total} current signals`, status: 'Connected' };
      })
    : [];
  const allClear = attention.length === 0;

  return (
    <>
      <Top
        eyebrow={copy.eyebrow}
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${firstName}`}
        right={<button className="btn secondary" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>}
      />

      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="topbar" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow">{allClear ? 'Operations clear' : 'Start here'}</div>
            <h2>{allClear ? 'Nothing urgent is blocking your day' : `${attention.length} area${attention.length === 1 ? '' : 's'} need attention`}</h2>
            <p className="muted">{copy.summary}</p>
          </div>
          <div className="toolbar" style={{ margin: 0 }}>
            <Link className="btn" href="/tasks?create=1">New task</Link>
            <Link className="btn secondary" href="/requests?create=1">New request</Link>
            <Link className="btn secondary" href="/fixes?create=1">Report issue</Link>
            <Link className="btn secondary" href="/shift?create=1">Shift note</Link>
          </div>
        </div>
      </section>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Metric label="My overdue" value={overdueCount} detail="Assigned tasks past due" href="/my-work" urgent />
        <Metric label="Waiting for review" value={count(counts.approve)} detail="Decisions requiring attention" href="/review" urgent={isExecutive} />
        <Metric label="Open maintenance" value={count(counts.fixes)} detail="Unresolved property issues" href="/fixes" />
      </div>

      <div className="grid cols-2">
        <WorkList title="My work" eyebrow="Assigned to you" items={personalRows} href="/my-work" empty="No assigned work needs attention." />
        {attention.length ? <WorkList title="Needs attention" eyebrow="Exceptions" items={attention} href={isExecutive ? '/review' : '/my-work'} empty="No urgent exceptions." /> : null}
        {isExecutive ? <WorkList title="Waiting for review" eyebrow="Decisions" items={approvals} href="/review" empty="No decisions are waiting." /> : null}
        {isLead || role === 'staff' ? <WorkList title="Shift handover" eyebrow="Current department" items={handover} href="/shift" empty="No unresolved handover notes." /> : null}
        {isExecutive ? <WorkList title="Connected apps" eyebrow="Latest signals" items={integrationAlerts} href="/review" empty="Connected applications are clear." /> : null}
      </div>

      {allClear ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="card-line"><Pill value="All clear" /><span className="muted">No additional exception panels are shown. Open a workspace only when you need deeper detail.</span></div>
        </section>
      ) : null}
    </>
  );
}
