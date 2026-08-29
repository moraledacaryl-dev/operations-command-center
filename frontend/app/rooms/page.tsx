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

  useEffect(() => {
    api.list('rooms', { active: false }).then(setRooms).catch((err: any) => setError(err.message || 'Rooms could not be loaded.'));
  }, []);

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
    <div className="grid cols-3">
      {visible.map(room => <Link className="card card-button" key={room.id} href={`/rooms/${room.id}`} aria-label={`Open ${room.name} operational memory`}>
        <div className="card-title">{room.name}</div>
        <div className="card-line"><Pill value={room.kind || 'Room'} /><Pill value={room.status || 'Active'} /></div>
        <span className="muted">Open operational history</span>
      </Link>)}
      {!visible.length ? <div className="empty">No matching rooms or areas.</div> : null}
    </div>
  </>;
}
