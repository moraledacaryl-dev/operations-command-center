'use client';
import { useEffect, useState } from 'react';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import Link from 'next/link';

function Stat({ label, value, href, tone }: { label: string; value: any; href: string; tone?: string }) {
  return <Link className={`stat ${tone || ''}`} href={href}><span className="muted">{label}</span><b>{value ?? 0}</b></Link>;
}

function MiniCard({ item, href }: { item: Entity; href: string }) {
  return (
    <Link className="card row-card" href={href}>
      <div className="card-title">{item.title || item.name}</div>
      <div className="card-line"><Pill value={item.kind} /><Pill value={item.status || item.review_status} /><Pill value={item.priority || item.urgency} /></div>
    </Link>
  );
}

export default function Home() {
  const [data, setData] = useState<Entity | null>(null);
  const [crossApp, setCrossApp] = useState<Entity | null>(null);
  async function loadHome() {
    const user = getStoredUser();
    const [dashboard, overview] = await Promise.all([
      api.dashboard({ department_id: getCurrentDepartmentId(user) }),
      api.integrationOverview(),
    ]);
    setData(dashboard);
    setCrossApp(overview);
  }
  useEffect(() => { loadHome(); }, []);
  const counts = data?.counts || {};
  const staff = crossApp?.staff || {};
  const pos = crossApp?.pos || {};
  const accounting = crossApp?.accounting || {};
  return (
    <>
      <Top eyebrow="Home" title="Today" right={<button className="btn secondary" onClick={loadHome}>Refresh</button>} />
      <div className="ops-strip">
        <Stat label="Late" value={counts.late} href="/tasks" tone={counts.late ? 'urgent-stat' : ''} />
        <Stat label="Approve" value={counts.approve} href="/review" tone={counts.approve ? 'warn-stat' : ''} />
        <Stat label="Fixes" value={counts.fixes} href="/fixes" />
        <Stat label="Guests" value={counts.guests} href="/guests" />
        <Stat label="Posts" value={counts.posts} href="/posts" />
        <Stat label="Tasks" value={counts.tasks} href="/tasks" />
      </div>
      <div className="ops-strip">
        <Stat label="Staff on duty" value={staff.staff_on_duty_today} href="/review" />
        <Stat label="Attendance" value={staff.attendance_exceptions} href="/review" tone={staff.attendance_exceptions ? 'warn-stat' : ''} />
        <Stat label="OT pending" value={staff.ot_pending} href="/review" />
        <Stat label="POS sales" value={pos.sales ? `PHP ${Number(pos.sales).toLocaleString()}` : 0} href="/review" />
        <Stat label="Room charges" value={pos.pending_room_charges} href="/review" tone={pos.pending_room_charges ? 'warn-stat' : ''} />
        <Stat label="Acct review" value={Object.values(accounting).reduce((sum: number, value: any) => sum + Number(value || 0), 0)} href="/review" />
      </div>
      <div className="command-band">
        <Link className="btn" href="/review">Review</Link>
        <Link className="btn secondary" href="/shift">Add shift note</Link>
        <Link className="btn secondary" href="/requests">New request</Link>
        <Link className="btn secondary" href="/guests">Guest follow-up</Link>
      </div>
      <div className="grid cols-2">
        <section className="panel">
          <h2>Focus</h2>
          <div className="grid" style={{ marginTop: 14 }}>
            {data?.focus?.length ? data.focus.map((x: Entity, i: number) => <MiniCard key={`${x.kind}-${x.id}-${i}`} item={x} href={x.kind === 'Task' ? '/tasks' : x.kind === 'Guest' ? '/guests' : x.kind === 'Fix' ? '/fixes' : '/posts'} />) : <div className="empty">All clear</div>}
          </div>
        </section>
        <section className="panel">
          <h2>Shift</h2>
          <div className="grid" style={{ marginTop: 14 }}>
            {data?.previous_shift?.length ? data.previous_shift.map((x: Entity) => <MiniCard key={x.id} item={{ ...x, kind: 'Shift' }} href="/shift" />) : <div className="empty">No notes</div>}
          </div>
        </section>
        <section className="panel">
          <h2>Approve</h2>
          <div className="grid" style={{ marginTop: 14 }}>
            {data?.approvals?.length ? data.approvals.map((x: Entity) => <MiniCard key={x.id} item={{ ...x, kind: 'Approve' }} href="/review" />) : <div className="empty">All clear</div>}
          </div>
        </section>
        <section className="panel">
          <h2>Memory</h2>
          <p className="muted" style={{ lineHeight: 1.7 }}>Closed work moves to History. Nothing important is deleted.</p>
        </section>
      </div>
    </>
  );
}
