'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Icon } from '@/components/Icon';
import { SpaceVisual } from '@/components/SpaceVisual';
import { WorkspaceStats } from '@/components/WorkspaceStats';

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Entity[]>([]);
  const [media, setMedia] = useState<Record<number, Entity>>({});
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('All');
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMedia = useCallback(async (rows: Entity[]) => {
    const results = await Promise.all(rows.map(async room => {
      try {
        const response = await fetch(`${API_BASE}/property-media/rooms/${room.id}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return [Number(room.id), { configured: false }] as const;
        return [Number(room.id), await response.json()] as const;
      } catch {
        return [Number(room.id), { configured: false }] as const;
      }
    }));
    setMedia(existing => ({ ...existing, ...Object.fromEntries(results) }));
  }, []);

  const load = useCallback(async (cursor?: string | null) => {
    setLoading(true);
    setError('');
    try {
      const page = await api.page('rooms', { active: false, limit: 30, cursor: cursor || '' });
      setRooms(existing => cursor ? [...existing, ...page.items] : page.items);
      setNextCursor(page.next_cursor || null);
      await loadMedia(page.items);
    } catch (err: any) {
      setError(err.message || 'Rooms could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [loadMedia]);

  useEffect(() => { void load(); }, [load]);

  const kinds = useMemo(() => ['All', ...Array.from(new Set(rooms.map(room => String(room.kind || 'Room'))))], [rooms]);
  const visible = useMemo(() => rooms.filter(room => {
    const matchesKind = kind === 'All' || String(room.kind || 'Room') === kind;
    const haystack = [room.name, room.kind, room.status, room.note].filter(Boolean).join(' ').toLowerCase();
    return matchesKind && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })), [rooms, query, kind]);

  return <div className="spaces-workspace" aria-busy={loading}>
    <Top title="Rooms & spaces" right={<Link className="btn secondary" href="/fixes?create=1"><Icon name="plus" />Report an issue</Link>} />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    <WorkspaceStats items={[
      { label: 'Spaces', value: loading || error ? null : rooms.length, detail: nextCursor ? 'Loaded so far' : undefined, icon: 'home' },
      { label: 'Guest rooms', value: loading || error ? null : rooms.filter(r => r.kind === 'room').length, icon: 'rooms' },
      { label: 'Shared areas', value: loading || error ? null : rooms.filter(r => r.kind !== 'room').length, icon: 'leaf' },
    ]} />
    <div className="spaces-toolbar">
      <div className="spaces-filters" aria-label="Space type">{kinds.map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'All' ? 'All spaces' : value === 'room' ? 'Guest rooms' : value === 'area' ? 'Shared areas' : value}</button>)}</div>
      <input className="input" aria-label="Search rooms and areas" placeholder="Find a room or space…" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <div className="spaces-results"><span>{visible.length} {visible.length === 1 ? 'space' : 'spaces'}{nextCursor ? ' loaded' : ''}</span><span>Details · Guest matters · Maintenance</span></div>
    <div className="spaces-grid">
      {visible.map(room => {
        const roomMedia = media[Number(room.id)];
        return <Link className="space-card" key={room.id} href={`/rooms/${room.id}`} aria-label={`Open ${room.name}`}>
          <SpaceVisual name={room.name} kind={room.kind} photo={roomMedia?.configured ? roomMedia.content_url : undefined} />
          <div className="space-card-copy"><div className="space-card-type">{room.kind === 'room' ? 'Guest room' : 'Shared space'}<Pill value={room.status || 'Active'} /></div>
            <h2>{room.name}</h2><p>{room.note}</p>
            <span className="space-card-footer">Explore space<Icon name="arrow" /></span>
          </div>
        </Link>;
      })}
    </div>
    {!visible.length ? <div className="empty" role="status"><Icon name={loading ? 'refresh' : 'rooms'} />{loading ? 'Loading your property…' : error ? 'Rooms are unavailable. Please try again.' : 'No spaces match your search.'}{!loading && (query || kind !== 'All') ? <button className="btn secondary" onClick={() => { setQuery(''); setKind('All'); }}>Clear filters</button> : null}{error ? <button className="btn secondary" onClick={() => void load()}>Try again</button> : null}</div> : null}
    {nextCursor ? <div className="load-more"><button className="btn secondary" disabled={loading} onClick={() => void load(nextCursor)}>{loading ? 'Loading…' : 'Load more spaces'}</button></div> : null}
  </div>;
}
