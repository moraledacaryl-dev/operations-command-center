'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Entity[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('All');
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(cursor?: string | null) {
    setLoading(true);
    setError('');
    try {
      const page = await api.page('rooms', { active: false, limit: 30, cursor: cursor || '' });
      setRooms(existing => cursor ? [...existing, ...page.items] : page.items);
      setNextCursor(page.next_cursor || null);
    } catch (err: any) {
      setError(err.message || 'Rooms could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const kinds = useMemo(() => ['All', ...Array.from(new Set(rooms.map(room => String(room.kind || 'Room'))))], [rooms]);
  const visible = useMemo(() => rooms.filter(room => {
    const matchesKind = kind === 'All' || String(room.kind || 'Room') === kind;
    const haystack = [room.name, room.kind, room.status].filter(Boolean).join(' ').toLowerCase();
    return matchesKind && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [rooms, query, kind]);

  return <>
    <Top eyebrow="Property memory" title="Rooms & areas" />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input className="input" aria-label="Search rooms and areas" placeholder="Search room or area" value={query} onChange={event => setQuery(event.target.value)} />
        <select className="select" aria-label="Room or area type" value={kind} onChange={event => setKind(event.target.value)}>{kinds.map(value => <option key={value}>{value}</option>)}</select>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>{visible.length} of {rooms.length} spaces shown. Open a space for its guest matters and maintenance history.</p>
    </section>
    <div className="grid cols-3 room-card-grid">
      {visible.map(room => <Link className="card card-button room-card" key={room.id} href={`/rooms/${room.id}`} aria-label={`Open ${room.name} operational memory`}>
        <span className="room-card-media" aria-hidden="true" />
        <span className="room-card-info">
          <span className="card-title">{room.name}</span>
          <span className="card-line"><Pill value={room.kind || 'Room'} /><Pill value={room.status || 'Active'} /></span>
          <span className="muted room-card-link">Open operational history</span>
        </span>
      </Link>)}
      {!visible.length ? <div className="empty">No matching rooms or areas.</div> : null}
    </div>
    {nextCursor ? <div className="load-more"><button className="btn secondary" disabled={loading} onClick={() => void load(nextCursor)}>{loading ? 'Loading…' : 'Load more spaces'}</button><span className="muted" aria-live="polite">{rooms.length} spaces loaded</span></div> : null}
  </>;
}
