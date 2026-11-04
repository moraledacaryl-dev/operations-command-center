'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { API_BASE } from '@/lib/api';
import { Top } from '@/components/Top';
import { getStoredUser } from '@/lib/session';
import './housekeeping.css';

type Check = { key: string; label: string; checked: boolean };
type Turnover = {
  id: number | null; room_area_id: number; room_name: string;
  service_date: string; status: string; source: string | null;
  vacated_confirmed: boolean; checklist: Check[];
  started_by_id?: number | null; submitted_by_id?: number | null;
  inspected_by_id?: number | null; inspected_at?: string | null;
  rework_note?: string | null;
  booking_updates?: { status: string; origin: string; check_in: string; check_out: string; reported_at: string }[];
};
type Board = { date: string; rooms: Turnover[]; can_schedule: boolean; can_clean: boolean; can_inspect: boolean; accounting_connected?: boolean };
const STATUS_TEXT: Record<string,string> = {
  'No cleaning request': 'No cleaning request for this date',
  'Needs cleaning': 'Waiting to be cleaned',
  'Cleaning': 'Cleaning in progress',
  'For inspection': 'Needs supervisor inspection',
  'Cleared': 'Inspected and cleared',
  'Needs rework': 'Return for cleaning',
};

function propertyDay() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function call<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + '/housekeeping' + path, {
    ...options, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(res.status >= 500 ? 'Room cleaning is unavailable. Refresh or ask your manager for help.' : typeof body?.detail === 'string' ? body.detail : 'Could not complete this action.');
  }
  return res.json();
}

export default function HousekeepingPage() {
  const [day, setDay] = useState(propertyDay);
  const [data, setData] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [rework, setRework] = useState<Record<number,string>>({});
  const latestRequest = useRef(0);
  const selfId = Number(getStoredUser()?.id || 0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    if (!day) {
      setData(null);
      setLoading(false);
      setError('Choose a date to see rooms.');
      return;
    }
    setLoading(true);
    try {
      const value = await call<Board>('/turnovers?service_date=' + encodeURIComponent(day));
      if (requestId !== latestRequest.current) return;
      setData(value);
      setError('');
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setData(null);
      setError(err instanceof Error ? err.message : 'Could not load room cleaning.');
    } finally { if (requestId === latestRequest.current) setLoading(false); }
  }, [day]);
  useEffect(() => { void load(); }, [load]);

  async function act(row: Turnover, path: string, payload?: object, method = 'POST') {
    setBusy(row.room_area_id);
    setError('');
    try {
      await call(path, { method, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the cleaning update.'); }
    finally { setBusy(null); }
  }

  const board = data?.date === day ? data : null;
  const visible = useMemo(() => (board?.rooms || []).filter(room => {
    const matched = room.room_name.toLowerCase().includes(search.trim().toLowerCase());
    return matched && (status === 'All' || room.status === status);
  }), [board, search, status]);
  const counts = useMemo(() => {
    const rooms = board?.rooms || [];
    return {
      waiting: rooms.filter(room => room.status === 'Needs cleaning' || room.status === 'Needs rework').length,
      cleaning: rooms.filter(room => room.status === 'Cleaning').length,
      inspection: rooms.filter(room => room.status === 'For inspection').length,
      cleared: rooms.filter(room => room.status === 'Cleared').length,
    };
  }, [board]);

  return <div className="housekeeping-board" aria-busy={loading}>
    <Top title="Room cleaning" right={<Link href="/rooms" className="btn secondary">All rooms</Link>} />
    <p className="hk-intro">This page is for cleaning after checkout. If a guest is staying and asks for cleaning, ask your lead to arrange a time with them.</p>
    <div className="hk-tools">
      <label>Date <input aria-label="Cleaning date" className="input" type="date" value={day} disabled={busy !== null} onChange={e => setDay(e.target.value)} /></label>
      <label>Find room <input aria-label="Find room" className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Solace, Perch 1…" /></label>
      <label>Show <select aria-label="Cleaning status" className="select" value={status} onChange={e => setStatus(e.target.value)}>
        <option>All</option>{Object.keys(STATUS_TEXT).map(key => <option key={key} value={key}>{STATUS_TEXT[key]}</option>)}
      </select></label>
      <button type="button" className="btn secondary" disabled={loading} onClick={() => void load()}>Refresh</button>
    </div>
    {error ? <p role="alert" className="hk-error">{error}</p> : null}
    {board && <div className="hk-counts" aria-label="Cleaning progress">
      <div><strong>{counts.waiting}</strong><span>To clean</span></div>
      <div><strong>{counts.cleaning}</strong><span>Cleaning</span></div>
      <div><strong>{counts.inspection}</strong><span>Inspection</span></div>
      <div><strong>{counts.cleared}</strong><span>Cleared</span></div>
    </div>}
    {!board && loading && <p role="status">Loading rooms…</p>}
    <div className="hk-room-grid">
      {visible.map(row => {
        const isBusy = loading || busy !== null;
        const mine = Number(row.started_by_id) === selfId;
        const checks = row.checklist.filter(item => item.checked).length;
        return <article key={row.room_area_id} className="hk-room-card" data-testid={'cleaning-room-' + row.room_area_id}>
          <header><h2>{row.room_name}</h2><span className="hk-status">Cleaning: {STATUS_TEXT[row.status] || row.status}</span></header>
          <div className="hk-guest-status">
            <strong>Guest status</strong>
            {day !== propertyDay() ? <p>Not available for this date. Check with Front Desk.</p>
              : !(row.booking_updates || []).length ? <p>Not confirmed. Check with Front Desk.</p>
              : <>{(row.booking_updates || []).map((update, index) => <p key={index}>
                {({ checked_in: 'Check-in recorded', checked_out: 'Checkout recorded', confirmed: 'Booking confirmed; check-in not confirmed', cancelled: 'Booking cancelled', no_show: 'Guest did not arrive' } as Record<string,string>)[update.status] || 'Guest status not confirmed'}
                {' · Received: '}{new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(update.reported_at.endsWith('Z') || /[+-]\d\d:\d\d$/.test(update.reported_at) ? update.reported_at : update.reported_at + 'Z'))}
              {' · Stay: '}{update.check_in} to {update.check_out}</p>)}<p>Confirm with Front Desk before entering.</p></>}
          </div>
          {row.id === null ? <>
            {board?.can_schedule && <button type="button" className="btn" disabled={isBusy}
              onClick={() => void act(row, '/turnovers', { room_area_id: row.room_area_id, service_date: day })}>Schedule cleaning</button>}
          </> : <>
            {!row.vacated_confirmed ? <div className="hk-warning">
              <strong>Waiting for Front Desk.</strong>
              <p>Front Desk needs to confirm the guest has left.</p>
              {board?.can_schedule && <button type="button" className="btn" disabled={isBusy}
                onClick={() => { if (window.confirm('Has the guest left and is the room empty?')) void act(row, '/turnovers/' + row.id + '/confirm-vacated'); }}>
                Confirm guest has left</button>}
            </div> : null}
            {row.status === 'Needs rework' && <p className="hk-warning"><strong>Check again:</strong> {row.rework_note || 'The supervisor asked for another clean.'}</p>}
            {row.vacated_confirmed && ['Needs cleaning', 'Needs rework'].includes(row.status) && board?.can_clean && <button type="button"
              className="btn" disabled={isBusy} onClick={() => void act(row, '/turnovers/' + row.id + '/start')}>Start cleaning</button>}
            {['Cleaning', 'For inspection', 'Cleared'].includes(row.status) && <>
              <div className="hk-check-progress"><strong>Checklist</strong><span>{checks} of {row.checklist.length} finished</span></div>
              <div className="hk-checklist">
                {row.checklist.map(item => <label key={item.key}>
                  <input type="checkbox" checked={item.checked} disabled={isBusy || row.status !== 'Cleaning' || !mine || !board?.can_clean}
                    onChange={event => void act(row, '/turnovers/' + row.id + '/items/' + item.key, { checked: event.target.checked }, 'PATCH')} />
                  <span>{item.label}</span>
                </label>)}
              </div>
            </>}
            {row.status === 'Cleaning' && mine && board?.can_clean && <button className="btn" type="button"
              disabled={isBusy || checks !== row.checklist.length}
              onClick={() => void act(row, '/turnovers/' + row.id + '/submit')}>Send for inspection</button>}
            {row.status === 'For inspection' && <div className="hk-inspect">
              <p><strong>Waiting for inspection.</strong> A different supervisor must check this room.</p>
              {board?.can_inspect && row.started_by_id !== selfId && <>
                <button className="btn" disabled={isBusy} onClick={() => void act(row, '/turnovers/' + row.id + '/inspect', { cleared: true })}>Approve cleaning</button>
                <label>What needs fixing? <textarea className="textarea" value={rework[row.id!] || ''} onChange={event => setRework(v => ({ ...v, [row.id!]: event.target.value }))} placeholder="Example: Bathroom mirror still has water marks." /></label>
                <button className="btn secondary" disabled={isBusy || (rework[row.id!] || '').trim().length < 5}
                  onClick={() => void act(row, '/turnovers/' + row.id + '/inspect', { cleared: false, note: rework[row.id!] })}>Return for cleaning</button>
              </>}
            </div>}
            {row.status === 'Cleared' && <p className="hk-cleared">Cleaning approved. Check the booking before assigning the room.</p>}
          </>}
        </article>;
      })}
    </div>
    {board && !visible.length && <p role="status">No rooms match this view.</p>}
  </div>;
}
