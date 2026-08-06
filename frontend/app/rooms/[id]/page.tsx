'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

function dateLabel(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function RoomMemoryPage() {
  const params = useParams<{ id: string }>();
  const [memory, setMemory] = useState<Entity | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const id = Number(params.id);
    if (!id) return;
    api.roomMemory(id).then(setMemory).catch((err: any) => setError(err.message || 'Room memory could not be loaded.'));
  }, [params.id]);

  const room = memory?.room;
  const guests: Entity[] = memory?.guests || [];
  const fixes: Entity[] = memory?.fixes || [];
  const openGuest = guests.filter(item => item.status !== 'Done').length;
  const openFixes = fixes.filter(item => !['Verified', 'Done'].includes(String(item.status))).length;

  return <>
    <Top eyebrow="Property memory" title={room?.name || 'Room'} right={<Link className="btn secondary" href="/rooms">All rooms</Link>} />
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    {!memory && !error ? <div className="panel"><div className="empty">Loading room memory…</div></div> : null}
    {memory ? <>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="panel"><div className="eyebrow">Space</div><h2>{room?.kind || 'Room'}</h2><Pill value={room?.status || 'Active'} /></div>
        <div className="panel"><div className="eyebrow">Open guest matters</div><h2>{openGuest}</h2></div>
        <div className="panel"><div className="eyebrow">Open maintenance</div><h2>{openFixes}</h2></div>
      </div>
      <div className="grid cols-2">
        <section className="panel">
          <div className="topbar"><div><div className="eyebrow">Service recovery</div><h2>Guest matters</h2></div><Link className="btn small secondary" href="/guests?create=1">New matter</Link></div>
          <div className="grid" style={{ marginTop: 12 }}>
            {guests.map(item => <div className="card" key={item.id}>
              <strong>{item.title || item.guest_name || 'Guest matter'}</strong>
              <div className="card-line"><Pill value={item.issue_type} /><Pill value={item.status} /><Pill value={item.urgency} /></div>
              {item.guest_name ? <span className="muted">Guest: {item.guest_name}</span> : null}
              {dateLabel(item.follow_up_at || item.updated_at) ? <span className="muted">{dateLabel(item.follow_up_at || item.updated_at)}</span> : null}
            </div>)}
            {!guests.length ? <div className="empty">No guest matters for this space.</div> : null}
          </div>
        </section>
        <section className="panel">
          <div className="topbar"><div><div className="eyebrow">Repair history</div><h2>Maintenance</h2></div><Link className="btn small secondary" href="/fixes?create=1">Report issue</Link></div>
          <div className="grid" style={{ marginTop: 12 }}>
            {fixes.map(item => <div className="card" key={item.id}>
              <strong>{item.title || 'Maintenance item'}</strong>
              <div className="card-line"><Pill value={item.status} /><Pill value={item.urgency} /></div>
              {item.technician_name ? <span className="muted">Assigned: {item.technician_name}</span> : null}
              {dateLabel(item.target_date || item.updated_at) ? <span className="muted">{dateLabel(item.target_date || item.updated_at)}</span> : null}
            </div>)}
            {!fixes.length ? <div className="empty">No maintenance history for this space.</div> : null}
          </div>
        </section>
      </div>
    </> : null}
  </>;
}
