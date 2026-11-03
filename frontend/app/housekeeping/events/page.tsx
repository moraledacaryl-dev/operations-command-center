'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { API_BASE } from '@/lib/api';
import { Top } from '@/components/Top';
import { getStoredUser } from '@/lib/session';
import '../housekeeping.css';
import './events.css';

type EventTask = {
  id: number; title: string; status: string;
  phase: 'Before event' | 'After event' | 'Other event work';
  due_date: string | null; assigned: boolean;
};
type VenueEvent = {
  project_id: number; event_no: string; venue: string; event_date: string | null;
  tasks: EventTask[];
};
type EventBoard = { events: VenueEvent[] };
const phases: EventTask['phase'][] = ['Before event', 'After event', 'Other event work'];

function dayLabel(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Confirm date in Accounting';
  const date = new Date(value + 'T12:00:00+08:00');
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(date);
}

function taskDay(value: string | null): string {
  if (!value) return 'No due date';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Check due date' :
    new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' }).format(date);
}

export default function EventVenuePage() {
  const [board, setBoard] = useState<EventBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(true);
  const [canViewProject, setCanViewProject] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(API_BASE + '/housekeeping/event-venues', {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not load event venue work.');
      }
      setBoard(await response.json() as EventBoard);
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not load event venue work.');
      setBoard(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const user = getStoredUser();
    setCanViewProject(['owner', 'admin', 'manager'].includes(String(user?.role || '').toLowerCase()));
    void load();
  }, [load]);

  const events = useMemo(() => (board?.events || [])
    .filter(item => (item.venue + ' ' + item.event_no).toLowerCase().includes(query.trim().toLowerCase()))
    .map(item => ({ ...item, tasks: item.tasks.filter(task => showDone || task.status !== 'Done') }))
    .filter(item => item.tasks.length > 0), [board, query, showDone]);

  return <div className="housekeeping-board hk-event-board">
    <Top title="Event venue work" right={<Link href="/housekeeping" className="btn secondary">Room cleaning</Link>} />
    <p className="hk-intro">Prepare and clean event venues. <strong>These are event jobs, not guest-room cleaning.</strong>
      Each event has a venue. Check Accounting for the latest booking details.</p>
    <div className="hk-event-tools">
      <label>Find event or venue
        <input className="input" aria-label="Find event or venue" placeholder="Garden, Function Hall, event number…"
          value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <label className="hk-event-toggle">
        <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show finished jobs
      </label>
      <button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>Refresh</button>
    </div>
    <p className="hk-event-note">Changes or cancellations need a manager review. Deadlines do not change automatically.
      This page does not mark a room or venue available.</p>
    {loading && <p role="status">Loading event venue work…</p>}
    {error && <p role="alert" className="hk-error">{error}</p>}
    {!loading && board && !events.length &&
      <p role="status">No matching venue jobs. Confirmed events appear after Accounting sends them to Operations.</p>}
    <div className="hk-event-grid">
      {events.map(item => <article key={item.project_id} className="hk-room-card hk-event-card"
        data-testid={'venue-event-' + item.project_id}>
        <header>
          <div><small className="hk-event-reference">{item.event_no}</small><h2>{item.venue}</h2></div>
          <span className="hk-status">{dayLabel(item.event_date)}</span>
        </header>
        {phases.map(phase => {
          const tasks = item.tasks.filter(task => task.phase === phase);
          return tasks.length ? <section key={phase} className="hk-event-phase">
            <h3>{phase}</h3>
            <ul>
              {tasks.map(task => <li key={task.id} data-testid={'venue-task-' + task.id}>
                <div className="hk-event-job">
                  <strong>{task.title.replace(/^(Before event: |After event: )/, '')}</strong>
                  <span className="hk-status">{task.status}</span>
                </div>
                <small>Due: {taskDay(task.due_date)} · {task.assigned ? 'Assigned' : 'Needs assignment'}</small>
              </li>)}
            </ul>
          </section> : null;
        })}
        <footer className="hk-event-links">
          <Link href="/tasks" className="btn secondary">Open tasks</Link>
          {canViewProject && <Link href={'/projects/' + item.project_id} className="btn secondary">Open event project</Link>}
        </footer>
      </article>)}
    </div>
    <small className="hk-footer">Update these jobs in Operations Tasks. Room-cleaning checklists stay separate.
      Managers must check Accounting for any changed event details.</small>
  </div>;
}
