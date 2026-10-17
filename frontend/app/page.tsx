'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { WorkspaceStats } from '@/components/WorkspaceStats';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { useLatestRequest } from '@/lib/operation-hooks';

function count(value: unknown) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function WorkList({ title, items, href, empty, loading, unavailable }: { title: string; items: Entity[]; href: string; empty: string; loading: boolean; unavailable?: boolean }) {
  return <section className="today-list"><header><h2>{title}</h2><Link href={href} aria-label={`View ${title.toLowerCase()}`}>View all <Icon name="arrow" /></Link></header>
    <div className="today-list-body">{loading ? <div className="today-empty" role="status"><Icon name="refresh" /><span>Loading your workspace…</span></div> : unavailable ? <div className="today-empty"><Icon name="refresh" /><span>Couldn’t load this section. Try refreshing.</span></div> : items.length ? items.slice(0, 4).map((item, index) => <Link key={item.id || index} className="today-work-row" href={item.href || href}><span className="today-row-icon"><Icon name={item.icon || 'tasks'} /></span><span><strong>{item.title || item.name || item.summary || 'Work item'}</strong><span className="today-row-meta">{item.status || item.review_status ? <Pill value={item.status || item.review_status} /> : null}{item.priority || item.urgency ? <Pill value={item.priority || item.urgency} /> : null}{item.department_name ? <span>{item.department_name}</span> : null}</span></span><Icon className="today-row-arrow" name="arrow" /></Link>) : <div className="today-empty"><span className="today-empty-icon"><Icon name="check" /></span><strong>{empty}</strong></div>}</div>
  </section>;
}

export default function Home() {
  const [dashboard, setDashboard] = useState<Entity>({});
  const [myWork, setMyWork] = useState<Entity>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({ dashboard: false, work: false });
  const beginRequest = useLatestRequest();
  const user = getStoredUser();
  const role = String(user?.role || 'staff').toLowerCase();
  const executive = ['owner', 'admin', 'manager'].includes(role);
  const load = useCallback(async () => {
    const request = beginRequest();
    setLoading(true);
    const [summary, work] = await Promise.allSettled([
      api.dashboard({ department_id: getCurrentDepartmentId(getStoredUser()) }), api.list('my-work'),
    ]);
    if (!request.isCurrent()) return;
    if (summary.status === 'fulfilled') setDashboard(summary.value);
    if (work.status === 'fulfilled') setMyWork(work.value as unknown as Entity);
    setErrors({ dashboard: summary.status === 'rejected', work: work.status === 'rejected' });
    setLoading(false);
  }, [beginRequest]);
  useEffect(() => { void load(); }, [load]);

  const counts = dashboard.counts || {}, groups = myWork.groups || {};
  const overdue = count(groups.overdue?.length), review = count(counts.approve), fixes = count(counts.fixes);
  const attention: Entity[] = [];
  if (overdue) attention.push({ title: `${overdue} assigned task${overdue === 1 ? '' : 's'} past due`, status: 'Overdue', icon: 'clock', href: '/my-work' });
  if (review) attention.push({ title: `${review} decision${review === 1 ? '' : 's'} waiting for review`, status: 'Pending', icon: 'review', href: '/review' });
  if (fixes) attention.push({ title: `${fixes} open maintenance item${fixes === 1 ? '' : 's'}`, status: 'Open', icon: 'maintenance', href: '/fixes' });
  const personal = [...(groups.overdue || []), ...(groups.today || []), ...(groups.waiting || []), ...(groups.upcoming || [])];
  const incomplete = errors.dashboard || errors.work;
  const now = new Date();
  return <div className="today-workspace" aria-busy={loading}>
    <Top title="Today" right={<div className="today-heading-actions"><button className="ops-icon-button" aria-label="Refresh overview" title="Refresh" onClick={() => void load()} disabled={loading}><Icon name="refresh" /></button><Link className="btn" href="/tasks?create=1"><Icon name="plus" />New task</Link></div>} />
    {incomplete && !loading ? <p role="alert" className="today-error">Some updates couldn’t be loaded. Refresh to try again.</p> : null}
    <section className="today-hero"><div><span className="today-date"><span className="ops-status-dot" />{now.toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long' })}</span><h2>{loading ? 'Loading…' : incomplete ? 'Some updates are unavailable.' : attention.length ? `${attention.length} area${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} your attention.` : 'No items need attention.'}</h2></div><div className="today-hero-art" aria-hidden="true"><Icon name={attention.length ? 'leaf' : 'sun'} /></div></section>
    <WorkspaceStats items={[
      { label: 'My overdue tasks', value: loading || errors.work ? null : overdue, detail: errors.work ? 'Unavailable' : undefined, icon: 'clock', href: '/my-work', attention: true },
      { label: 'Waiting for review', value: loading || errors.dashboard ? null : review, detail: errors.dashboard ? 'Unavailable' : undefined, icon: 'review', href: '/review' },
      { label: 'Open maintenance', value: loading || errors.dashboard ? null : fixes, detail: errors.dashboard ? 'Unavailable' : undefined, icon: 'maintenance', href: '/fixes' },
    ]} />
    <div className="today-columns"><div className="today-main-lists">
      <WorkList title={attention.length ? 'Needs attention' : 'My work'} items={attention.length ? attention : personal} href={attention.length ? '/review' : '/my-work'} empty="No assigned tasks" loading={loading} unavailable={incomplete} />
      {attention.length > 0 && <WorkList title="My work" items={personal} href="/my-work" empty="No assigned tasks" loading={loading} unavailable={errors.work} />}
      <WorkList title={executive ? 'Waiting for review' : 'Shift handover'} items={executive ? dashboard.approvals || [] : dashboard.previous_shift || []} href={executive ? '/review' : '/shift'} empty={executive ? 'No decisions waiting' : 'No handover notes'} loading={loading} unavailable={errors.dashboard} />
    </div><aside className="today-quick"><h2>Quick actions</h2><div className="today-shortcuts"><Link href="/fixes?create=1"><Icon name="maintenance" /><strong>Report issue</strong></Link><Link href="/requests?create=1"><Icon name="request" /><strong>New request</strong></Link></div><div className="today-handover"><span className="today-handover-icon"><Icon name="shift" /></span><h3>Shift handover</h3><Link href="/shift?create=1">Add a shift note <Icon name="arrow" /></Link></div></aside></div>
  </div>;
}
