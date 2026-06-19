'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

function WorkCard({ item, href, kind }: { item: Entity; href: string; kind: string }) {
  return (
    <Link className="card" href={href}>
      <div className="card-title">{item.title || item.name || 'Item'}</div>
      <div className="card-line">
        <Pill value={kind} />
        <Pill value={item.status || item.review_status} />
        <Pill value={item.priority || item.urgency} />
      </div>
      {item.note || item.reason ? <span className="muted">{String(item.note || item.reason).slice(0, 90)}</span> : null}
    </Link>
  );
}

function StatLink({ label, value, href }: { label: string; value: number; href: string }) {
  return <Link className="stat" href={href}><span className="muted">{label}</span><b>{value}</b></Link>;
}

export default function MyWorkPage() {
  const [user, setUser] = useState<Entity | null>(null);
  const [tasks, setTasks] = useState<Entity[]>([]);
  const [requests, setRequests] = useState<Entity[]>([]);
  const [shiftNotes, setShiftNotes] = useState<Entity[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const stored = getStoredUser();
    setUser(stored);
    const departmentId = getCurrentDepartmentId(stored);
    try {
      const [taskRows, requestRows, shiftRows] = await Promise.all([
        api.list('tasks', { active: true, department_id: departmentId || '', limit: 40 }),
        api.list('requests', { active: true, department_id: departmentId || '', limit: 25 }),
        api.list('shift-notes', { active: true, department_id: departmentId || '', limit: 25 }),
      ]);
      const assigned = taskRows.filter((task: Entity) => Number(task.assigned_to_id) === Number(stored?.id));
      setTasks((assigned.length ? assigned : taskRows).slice(0, 6));
      setRequests(requestRows.slice(0, 4));
      setShiftNotes(shiftRows.slice(0, 4));
    } catch (err: any) {
      setError(err.message || 'Could not load your work.');
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <Top eyebrow="Daily" title="My Work" right={<button className="btn secondary" onClick={load}>Refresh</button>} />
      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
      <div className="ops-strip compact">
        <StatLink label="Tasks" value={tasks.length} href="/tasks" />
        <StatLink label="Requests" value={requests.length} href="/requests" />
        <StatLink label="Shift" value={shiftNotes.length} href="/shift" />
        <StatLink label="Department" value={user?.departments?.length || 0} href="/departments" />
      </div>
      <div className="grid cols-2">
        <section className="panel">
          <h2>Tasks</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {tasks.length ? tasks.map(task => <WorkCard key={task.id} item={task} href="/tasks" kind="Task" />) : <div className="empty">All clear</div>}
          </div>
        </section>
        <section className="panel">
          <h2>Shift</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {shiftNotes.length ? shiftNotes.map(note => <WorkCard key={note.id} item={note} href="/shift" kind="Shift" />) : <div className="empty">No notes</div>}
          </div>
        </section>
        <section className="panel">
          <h2>Requests</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {requests.length ? requests.map(request => <WorkCard key={request.id} item={request} href="/requests" kind="Request" />) : <div className="empty">No requests</div>}
          </div>
        </section>
        <section className="panel">
          <h2>Department</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {(user?.departments || []).map((dept: Entity) => (
              <Link className="card row-card" href={`/departments?dept=${dept.id}`} key={dept.id}>
                <div className="card-title">{dept.name}</div>
                <div className="card-line"><Pill value={dept.is_primary ? 'Primary' : 'Access'} /></div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
