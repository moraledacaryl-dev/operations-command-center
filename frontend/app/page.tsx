'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

const sourceLabels: Record<string, string> = {
  staff: 'Staff',
  pos: 'POS',
  accounting: 'Accounting',
  inventory: 'Inventory',
};

function number(value: any) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: any) {
  return `PHP ${number(value).toLocaleString()}`;
}

function itemHref(item: Entity) {
  const kind = String(item.kind || '').toLowerCase();
  if (kind.includes('task')) return '/tasks';
  if (kind.includes('guest')) return '/guests';
  if (kind.includes('fix') || kind.includes('maintenance')) return '/fixes';
  if (kind.includes('post') || kind.includes('marketing')) return '/posts';
  if (kind.includes('shift')) return '/shift';
  if (kind.includes('approval') || kind.includes('request')) return '/review';
  return '/review';
}

function itemTitle(item: Entity) {
  return item.title || item.name || item.summary || item.note || item.problem || 'Operational item';
}

function itemTime(item: Entity) {
  const raw = item.due_at || item.starts_at || item.created_at || item.updated_at;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Stat({ label, value, href, tone, detail }: { label: string; value: any; href: string; tone?: string; detail?: string }) {
  return <Link className={`stat ${tone || ''}`} href={href}>
    <span className="muted">{label}</span>
    <b>{value ?? 0}</b>
    {detail ? <small className="muted">{detail}</small> : null}
  </Link>;
}

function QueueItem({ item, href }: { item: Entity; href?: string }) {
  const time = itemTime(item);
  return <Link className="card row-card" href={href || itemHref(item)}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div className="card-title">{itemTitle(item)}</div>
      {time ? <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{time}</span> : null}
    </div>
    <div className="card-line">
      <Pill value={item.kind} />
      <Pill value={item.status || item.review_status} />
      <Pill value={item.priority || item.urgency} />
    </div>
  </Link>;
}

function HealthCard({ name, status, detail, href }: { name: string; status: 'Healthy' | 'Busy' | 'Needs attention'; detail: string; href: string }) {
  const tone = status === 'Needs attention' ? 'urgent' : status === 'Busy' ? 'warn' : '';
  return <Link className="card" href={href}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <div className="card-title">{name}</div>
      <Pill value={status} />
    </div>
    <div className={`muted ${tone}`} style={{ marginTop: 8 }}>{detail}</div>
  </Link>;
}

export default function Home() {
  const [data, setData] = useState<Entity | null>(null);
  const [crossApp, setCrossApp] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadHome() {
    setLoading(true);
    setError('');
    try {
      const user = getStoredUser();
      const [dashboard, overview] = await Promise.all([
        api.dashboard({ department_id: getCurrentDepartmentId(user) }),
        api.integrationOverview(),
      ]);
      setData(dashboard);
      setCrossApp(overview);
    } catch (err: any) {
      setError(err.message || 'Could not load the command center.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadHome(); }, []);

  const counts = data?.counts || {};
  const staff = crossApp?.staff || {};
  const pos = crossApp?.pos || {};
  const accounting = crossApp?.accounting || {};
  const inventory = crossApp?.inventory || {};

  const alerts = useMemo(() => {
    const rows: Entity[] = [];
    if (number(counts.late)) rows.push({ kind: 'Tasks', title: `${counts.late} overdue task${number(counts.late) === 1 ? '' : 's'}`, urgency: 'Urgent' });
    if (number(counts.approve)) rows.push({ kind: 'Approvals', title: `${counts.approve} decision${number(counts.approve) === 1 ? '' : 's'} waiting`, urgency: 'High' });
    if (number(staff.attendance_exceptions)) rows.push({ kind: 'Staff', title: `${staff.attendance_exceptions} attendance exception${number(staff.attendance_exceptions) === 1 ? '' : 's'}`, urgency: 'High' });
    if (number(staff.ot_pending)) rows.push({ kind: 'Staff', title: `${staff.ot_pending} overtime request${number(staff.ot_pending) === 1 ? '' : 's'} pending`, urgency: 'Normal' });
    if (number(pos.pending_room_charges)) rows.push({ kind: 'POS', title: `${pos.pending_room_charges} room charge${number(pos.pending_room_charges) === 1 ? '' : 's'} awaiting review`, urgency: 'High' });
    const accountingTotal = Object.values(accounting).reduce((sum: number, value: any) => sum + number(value), 0);
    if (accountingTotal) rows.push({ kind: 'Accounting', title: `${accountingTotal} accounting exception${accountingTotal === 1 ? '' : 's'} require review`, urgency: 'High' });
    return rows;
  }, [counts, staff, pos, accounting]);

  const timeline = useMemo(() => {
    const focus = (data?.focus || []).map((item: Entity) => ({ ...item, kind: item.kind || 'Focus' }));
    const shift = (data?.previous_shift || []).map((item: Entity) => ({ ...item, kind: 'Shift' }));
    const approvals = (data?.approvals || []).map((item: Entity) => ({ ...item, kind: 'Approval' }));
    return [...focus, ...shift, ...approvals]
      .sort((a, b) => {
        const aDate = new Date(a.due_at || a.starts_at || a.created_at || 0).getTime();
        const bDate = new Date(b.due_at || b.starts_at || b.created_at || 0).getTime();
        return aDate - bDate;
      })
      .slice(0, 8);
  }, [data]);

  const crossAppFeed = useMemo(() => {
    const rows: Entity[] = [];
    if (number(staff.staff_on_duty_today)) rows.push({ source: 'staff', title: `${staff.staff_on_duty_today} staff on duty today`, detail: number(staff.attendance_exceptions) ? `${staff.attendance_exceptions} attendance exceptions` : 'Attendance clear' });
    if (number(pos.sales) || number(pos.pending_room_charges)) rows.push({ source: 'pos', title: `${money(pos.sales)} recorded sales`, detail: number(pos.pending_room_charges) ? `${pos.pending_room_charges} room charges pending` : 'No room-charge exceptions' });
    const accountingTotal = Object.values(accounting).reduce((sum: number, value: any) => sum + number(value), 0);
    rows.push({ source: 'accounting', title: accountingTotal ? `${accountingTotal} items need accounting review` : 'Accounting review clear', detail: 'Synced from Accounting' });
    const inventoryTotal = Object.values(inventory).reduce((sum: number, value: any) => sum + number(value), 0);
    if (Object.keys(inventory).length) rows.push({ source: 'inventory', title: inventoryTotal ? `${inventoryTotal} inventory exceptions` : 'Inventory review clear', detail: 'Synced from Inventory' });
    return rows;
  }, [staff, pos, accounting, inventory]);

  const totalAttention = number(counts.late) + number(counts.approve) + number(counts.fixes) + number(staff.attendance_exceptions) + number(pos.pending_room_charges);

  return <>
    <Top eyebrow="Command center" title="Today" right={<button className="btn secondary" onClick={loadHome} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>} />

    {error ? <div className="pill urgent" style={{ marginBottom: 14 }}>{error}</div> : null}

    <div className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div className="card-line"><Pill value={totalAttention ? 'Needs attention' : 'All clear'} /><span className="muted">Live operational view across Operations and connected apps.</span></div>
          <h2 style={{ marginTop: 10 }}>{totalAttention ? `${totalAttention} items need attention` : 'Operations are clear'}</h2>
        </div>
        <div className="command-band" style={{ margin: 0 }}>
          <Link className="btn" href="/tasks">+ Task</Link>
          <Link className="btn secondary" href="/requests">+ Request</Link>
          <Link className="btn secondary" href="/fixes">+ Maintenance</Link>
          <Link className="btn secondary" href="/guests">+ Guest note</Link>
          <Link className="btn secondary" href="/shift">+ Shift note</Link>
        </div>
      </div>
    </div>

    <div className="ops-strip">
      <Stat label="Overdue" value={counts.late} href="/tasks" tone={counts.late ? 'urgent-stat' : ''} detail="Tasks past due" />
      <Stat label="Review" value={counts.approve} href="/review" tone={counts.approve ? 'warn-stat' : ''} detail="Decisions waiting" />
      <Stat label="Maintenance" value={counts.fixes} href="/fixes" detail="Open fixes" />
      <Stat label="Guests" value={counts.guests} href="/guests" detail="Follow-ups" />
      <Stat label="Staff on duty" value={staff.staff_on_duty_today} href="/review" detail="Today" />
      <Stat label="POS sales" value={money(pos.sales)} href="/review" detail="Connected POS" />
    </div>

    <div className="grid cols-2" style={{ marginTop: 16 }}>
      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <h2>Critical alerts</h2>
          <Link className="btn small secondary" href="/review">Open review</Link>
        </div>
        <div className="grid" style={{ marginTop: 14 }}>
          {loading && !data ? <div className="empty">Loading alerts…</div> : alerts.length ? alerts.map((item, index) => <QueueItem key={`${item.kind}-${index}`} item={item} href={item.kind === 'Tasks' ? '/tasks' : '/review'} />) : <div className="empty">No critical alerts</div>}
        </div>
      </section>

      <section className="panel">
        <h2>Today's timeline</h2>
        <div className="grid" style={{ marginTop: 14 }}>
          {loading && !data ? <div className="empty">Loading timeline…</div> : timeline.length ? timeline.map((item: Entity, index: number) => <QueueItem key={`${item.kind}-${item.id || index}`} item={item} />) : <div className="empty">No scheduled operational items</div>}
        </div>
      </section>

      <section className="panel">
        <h2>Department health</h2>
        <div className="grid" style={{ marginTop: 14 }}>
          <HealthCard name="Reception" status={number(counts.guests) ? 'Busy' : 'Healthy'} detail={`${number(counts.guests)} guest follow-ups · ${number(counts.approve)} decisions waiting`} href="/guests" />
          <HealthCard name="Housekeeping" status={number(counts.tasks) || number(counts.late) ? (number(counts.late) ? 'Needs attention' : 'Busy') : 'Healthy'} detail={`${number(counts.tasks)} active tasks · ${number(counts.late)} overdue`} href="/tasks" />
          <HealthCard name="Maintenance" status={number(counts.fixes) ? 'Busy' : 'Healthy'} detail={`${number(counts.fixes)} open fixes`} href="/fixes" />
          <HealthCard name="People" status={number(staff.attendance_exceptions) ? 'Needs attention' : number(staff.ot_pending) ? 'Busy' : 'Healthy'} detail={`${number(staff.staff_on_duty_today)} on duty · ${number(staff.attendance_exceptions)} exceptions`} href="/review" />
        </div>
      </section>

      <section className="panel">
        <h2>Cross-app feed</h2>
        <div className="grid" style={{ marginTop: 14 }}>
          {crossAppFeed.length ? crossAppFeed.map((item: Entity) => <Link key={item.source} className="card row-card" href="/review">
            <div className="card-line"><Pill value={sourceLabels[item.source] || item.source} /></div>
            <div className="card-title">{item.title}</div>
            <div className="muted">{item.detail}</div>
          </Link>) : <div className="empty">No connected-app updates</div>}
        </div>
      </section>

      <section className="panel">
        <h2>Staff snapshot</h2>
        <div className="ops-strip" style={{ marginTop: 14 }}>
          <Stat label="On duty" value={staff.staff_on_duty_today} href="/review" />
          <Stat label="Attendance" value={staff.attendance_exceptions} href="/review" tone={staff.attendance_exceptions ? 'warn-stat' : ''} />
          <Stat label="OT pending" value={staff.ot_pending} href="/review" />
        </div>
        <div style={{ marginTop: 14 }}>
          <Link className="btn small secondary" href="/shift">Open shift handover</Link>
        </div>
      </section>

      <section className="panel">
        <h2>Financial & inventory snapshot</h2>
        <div className="ops-strip" style={{ marginTop: 14 }}>
          <Stat label="POS sales" value={money(pos.sales)} href="/review" />
          <Stat label="Room charges" value={pos.pending_room_charges} href="/review" tone={pos.pending_room_charges ? 'warn-stat' : ''} />
          <Stat label="Accounting" value={Object.values(accounting).reduce((sum: number, value: any) => sum + number(value), 0)} href="/review" />
          <Stat label="Inventory" value={Object.values(inventory).reduce((sum: number, value: any) => sum + number(value), 0)} href="/review" />
        </div>
      </section>
    </div>
  </>;
}
