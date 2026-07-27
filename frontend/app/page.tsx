'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import styles from './home.module.css';

const sourceLabels: Record<string, string> = {
  staff: 'Staff',
  pos: 'POS',
  accounting: 'Accounting',
  inventory: 'Inventory',
};

function numeric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(numeric(value));
}

function itemTitle(item: Entity) {
  return item.title || item.name || item.summary || item.note || item.problem || 'Operational item';
}

function itemHref(item: Entity) {
  const kind = String(item.kind || '').toLowerCase();
  if (kind.includes('task')) return '/tasks';
  if (kind.includes('project')) return '/projects';
  if (kind.includes('guest')) return '/guests';
  if (kind.includes('fix') || kind.includes('maintenance')) return '/fixes';
  if (kind.includes('post') || kind.includes('marketing')) return '/posts';
  if (kind.includes('shift')) return '/shift';
  return '/review';
}

function itemDate(item: Entity) {
  const raw = item.due_at || item.due_date || item.starts_at || item.created_at || item.updated_at;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SectionHeader({ title, eyebrow, href, linkLabel = 'View all' }: { title: string; eyebrow?: string; href?: string; linkLabel?: string }) {
  return (
    <div className={styles.sectionHeader}>
      <div>
        {eyebrow ? <div className={styles.sectionEyebrow}>{eyebrow}</div> : null}
        <h2>{title}</h2>
      </div>
      {href ? <Link className="btn small secondary" href={href}>{linkLabel}</Link> : null}
    </div>
  );
}

function WorkRow({ item, href }: { item: Entity; href?: string }) {
  const when = itemDate(item);
  return (
    <Link className={styles.workRow} href={href || itemHref(item)}>
      <div className={styles.workMain}>
        <div className={styles.workTitle}>{itemTitle(item)}</div>
        <div className={styles.workMeta}>
          {item.kind ? <Pill value={item.kind} /> : null}
          {item.status || item.review_status ? <Pill value={item.status || item.review_status} /> : null}
          {item.priority || item.urgency ? <Pill value={item.priority || item.urgency} /> : null}
        </div>
      </div>
      <div className={styles.workSide}>{when || 'Open'}</div>
    </Link>
  );
}

function Metric({ label, value, detail, href, tone = 'neutral' }: { label: string; value: string | number; detail: string; href: string; tone?: 'neutral' | 'urgent' | 'warn' | 'ok' }) {
  return (
    <Link className={`${styles.metric} ${styles[tone]}`} href={href}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </Link>
  );
}

function DepartmentPulse({ name, detail, href, state }: { name: string; detail: string; href: string; state: 'Clear' | 'Busy' | 'Attention' }) {
  return (
    <Link className={styles.pulseRow} href={href}>
      <div>
        <strong>{name}</strong>
        <span>{detail}</span>
      </div>
      <Pill value={state} />
    </Link>
  );
}

export default function Home() {
  const [data, setData] = useState<Entity | null>(null);
  const [crossApp, setCrossApp] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');
  const [integrationError, setIntegrationError] = useState('');
  const user = getStoredUser();

  async function loadHome() {
    setLoading(true);
    setDashboardError('');
    setIntegrationError('');

    const [dashboardResult, integrationResult] = await Promise.allSettled([
      api.dashboard({ department_id: getCurrentDepartmentId(getStoredUser()) }),
      api.integrationOverview(),
    ]);

    if (dashboardResult.status === 'fulfilled') setData(dashboardResult.value);
    else setDashboardError(dashboardResult.reason?.message || 'Core operations could not be loaded.');

    if (integrationResult.status === 'fulfilled') setCrossApp(integrationResult.value);
    else setIntegrationError(integrationResult.reason?.message || 'Connected apps could not be loaded.');

    setLoading(false);
  }

  useEffect(() => { loadHome(); }, []);

  const counts = data?.counts || {};
  const staff = crossApp?.staff || {};
  const pos = crossApp?.pos || {};
  const accounting = crossApp?.accounting || {};
  const inventory = crossApp?.inventory || {};
  const firstName = String(user?.name || 'there').trim().split(/\s+/)[0];
  const dateLabel = new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const attention = useMemo(() => {
    const rows: Entity[] = [];
    if (numeric(counts.late)) rows.push({ kind: 'Task', title: `${counts.late} overdue task${numeric(counts.late) === 1 ? '' : 's'}`, urgency: 'Urgent' });
    if (numeric(counts.approve)) rows.push({ kind: 'Approval', title: `${counts.approve} decision${numeric(counts.approve) === 1 ? '' : 's'} waiting for review`, urgency: 'High' });
    if (numeric(counts.fixes)) rows.push({ kind: 'Maintenance', title: `${counts.fixes} open maintenance item${numeric(counts.fixes) === 1 ? '' : 's'}`, urgency: 'Normal' });
    if (numeric(staff.attendance_exceptions)) rows.push({ kind: 'Staff', title: `${staff.attendance_exceptions} attendance exception${numeric(staff.attendance_exceptions) === 1 ? '' : 's'}`, urgency: 'High' });
    if (numeric(pos.pending_room_charges)) rows.push({ kind: 'POS', title: `${pos.pending_room_charges} room charge${numeric(pos.pending_room_charges) === 1 ? '' : 's'} awaiting review`, urgency: 'High' });
    return rows.slice(0, 6);
  }, [counts, staff, pos]);

  const today = useMemo(() => {
    const focus = (data?.focus || []).map((item: Entity) => ({ ...item, kind: item.kind || 'Focus' }));
    return focus.slice(0, 6);
  }, [data]);

  const handover = useMemo(() => (data?.previous_shift || []).slice(0, 4), [data]);
  const approvals = useMemo(() => (data?.approvals || []).slice(0, 4), [data]);

  const connected = useMemo(() => {
    const accountingTotal = Object.values(accounting).reduce((sum: number, value) => sum + numeric(value), 0);
    const inventoryTotal = Object.values(inventory).reduce((sum: number, value) => sum + numeric(value), 0);
    return [
      { source: 'staff', title: `${numeric(staff.staff_on_duty_today)} staff on duty`, detail: numeric(staff.attendance_exceptions) ? `${staff.attendance_exceptions} attendance exceptions` : 'Attendance clear' },
      { source: 'pos', title: `${money(pos.sales)} sales today`, detail: numeric(pos.pending_room_charges) ? `${pos.pending_room_charges} room charges pending` : 'No room-charge exceptions' },
      { source: 'accounting', title: accountingTotal ? `${accountingTotal} accounting items need review` : 'Accounting review clear', detail: 'Latest connected snapshot' },
      { source: 'inventory', title: inventoryTotal ? `${inventoryTotal} inventory exceptions` : 'Inventory review clear', detail: Object.keys(inventory).length ? 'Latest connected snapshot' : 'Waiting for inventory data' },
    ];
  }, [staff, pos, accounting, inventory]);

  const totalAttention = attention.length;

  return (
    <>
      <Top
        eyebrow={dateLabel}
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${firstName}`}
        right={<button className="btn secondary" onClick={loadHome} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>}
      />

      {dashboardError ? <div className="pill urgent" style={{ marginBottom: 12 }}>{dashboardError}</div> : null}
      {integrationError ? <div className="pill warn" style={{ marginBottom: 12 }}>Connected apps are temporarily unavailable. Core operations remain usable.</div> : null}

      <section className={styles.hero}>
        <div>
          <div className={styles.heroLabel}>{totalAttention ? 'Needs attention' : 'Operations clear'}</div>
          <h2>{totalAttention ? `${totalAttention} areas need your attention today` : 'Nothing urgent is blocking operations'}</h2>
          <p>{totalAttention ? 'Start with overdue work and decisions waiting for you.' : 'Review today’s work, handover notes and department activity.'}</p>
        </div>
        <div className={styles.quickActions}>
          <Link className="btn" href="/tasks">New task</Link>
          <Link className="btn secondary" href="/requests">New request</Link>
          <Link className="btn secondary" href="/fixes">Report issue</Link>
          <Link className="btn secondary" href="/shift">Shift note</Link>
        </div>
      </section>

      <div className={styles.metrics}>
        <Metric label="Overdue" value={numeric(counts.late)} detail="Tasks past due" href="/tasks" tone={numeric(counts.late) ? 'urgent' : 'ok'} />
        <Metric label="Waiting for me" value={numeric(counts.approve)} detail="Decisions to review" href="/review" tone={numeric(counts.approve) ? 'warn' : 'ok'} />
        <Metric label="Guest follow-ups" value={numeric(counts.guests)} detail="Open guest matters" href="/guests" />
        <Metric label="Maintenance" value={numeric(counts.fixes)} detail="Open issues" href="/fixes" tone={numeric(counts.fixes) ? 'warn' : 'ok'} />
      </div>

      <div className={styles.commandGrid}>
        <section className={`${styles.surface} ${styles.attentionPanel}`}>
          <SectionHeader title="Needs attention" eyebrow="Start here" href="/review" linkLabel="Open review" />
          <div className={styles.stack}>
            {loading && !data ? <div className="empty">Loading priorities…</div> : attention.length ? attention.map((item, index) => <WorkRow key={`${item.kind}-${index}`} item={item} href={item.kind === 'Task' ? '/tasks' : item.kind === 'Maintenance' ? '/fixes' : '/review'} />) : <div className={styles.clearState}><strong>All clear</strong><span>No urgent exceptions need your attention.</span></div>}
          </div>
        </section>

        <section className={styles.surface}>
          <SectionHeader title="My day" eyebrow="Priority work" href="/tasks" />
          <div className={styles.stack}>
            {loading && !data ? <div className="empty">Loading today’s work…</div> : today.length ? today.map((item: Entity, index: number) => <WorkRow key={`${item.kind}-${item.id || index}`} item={item} />) : <div className="empty">No urgent work is scheduled.</div>}
          </div>
        </section>

        <section className={styles.surface}>
          <SectionHeader title="Shift handover" eyebrow="Previous shift" href="/shift" linkLabel="Open handover" />
          <div className={styles.stack}>
            {handover.length ? handover.map((item: Entity, index: number) => <WorkRow key={item.id || index} item={{ ...item, kind: 'Shift note' }} href="/shift" />) : <div className="empty">No unresolved handover notes.</div>}
          </div>
        </section>

        <section className={styles.surface}>
          <SectionHeader title="Waiting for review" eyebrow="Decisions" href="/review" />
          <div className={styles.stack}>
            {approvals.length ? approvals.map((item: Entity, index: number) => <WorkRow key={item.id || index} item={{ ...item, kind: 'Approval' }} href="/review" />) : <div className="empty">No decisions are waiting.</div>}
          </div>
        </section>

        <section className={styles.surface}>
          <SectionHeader title="Department pulse" eyebrow="Operational health" href="/departments" linkLabel="Open workspaces" />
          <div className={styles.stack}>
            <DepartmentPulse name="Reception" state={numeric(counts.guests) ? 'Busy' : 'Clear'} detail={`${numeric(counts.guests)} guest follow-ups · ${numeric(counts.approve)} decisions`} href="/guests" />
            <DepartmentPulse name="Housekeeping" state={numeric(counts.late) ? 'Attention' : numeric(counts.tasks) ? 'Busy' : 'Clear'} detail={`${numeric(counts.tasks)} active tasks · ${numeric(counts.late)} overdue`} href="/tasks" />
            <DepartmentPulse name="Maintenance" state={numeric(counts.fixes) ? 'Busy' : 'Clear'} detail={`${numeric(counts.fixes)} open issues`} href="/fixes" />
            <DepartmentPulse name="People" state={numeric(staff.attendance_exceptions) ? 'Attention' : numeric(staff.ot_pending) ? 'Busy' : 'Clear'} detail={`${numeric(staff.staff_on_duty_today)} on duty · ${numeric(staff.attendance_exceptions)} exceptions`} href="/review" />
          </div>
        </section>

        <section className={styles.surface}>
          <SectionHeader title="Connected apps" eyebrow="Latest snapshots" href="/review" linkLabel="Open connected review" />
          <div className={styles.connectedGrid}>
            {connected.map(item => (
              <Link className={styles.connectedCard} href="/review" key={item.source}>
                <Pill value={sourceLabels[item.source]} />
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
