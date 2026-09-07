'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API_BASE, api, Entity } from '@/lib/api';
import { getStoredUser } from '@/lib/session';
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
  const [media, setMedia] = useState<Entity>({ configured: false });
  const [file, setFile] = useState<File | null>(null);
  const [busyMedia, setBusyMedia] = useState(false);
  const [error, setError] = useState('');
  const [user] = useState(() => getStoredUser());
  const isOwner = String(user?.role || '').toLowerCase() === 'owner';
  const roomId = Number(params.id);

  async function loadMedia() {
    if (!roomId) return;
    try {
      const response = await fetch(`${API_BASE}/property-media/rooms/${roomId}`, { credentials: 'same-origin', cache: 'no-store' });
      if (response.ok) setMedia(await response.json());
      else setMedia({ configured: false });
    } catch {
      setMedia({ configured: false });
    }
  }

  useEffect(() => {
    if (!roomId) return;
    api.roomMemory(roomId).then(setMemory).catch((err: any) => setError(err.message || 'Room memory could not be loaded.'));
    void loadMedia();
  }, [roomId]);

  async function uploadRoomPhoto() {
    if (!file || !roomId || busyMedia) return;
    setBusyMedia(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API_BASE}/property-media/rooms/${roomId}`, { method: 'POST', body: form, credentials: 'same-origin' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.detail || 'Room photo could not be saved.');
      setMedia(await response.json());
      setFile(null);
    } catch (err: any) {
      setError(err.message || 'Room photo could not be saved.');
    } finally {
      setBusyMedia(false);
    }
  }

  async function resetRoomPhoto() {
    if (!roomId || busyMedia) return;
    setBusyMedia(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/property-media/rooms/${roomId}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok && response.status !== 204) throw new Error('Room photo could not be reset.');
      setMedia({ configured: false });
      setFile(null);
    } catch (err: any) {
      setError(err.message || 'Room photo could not be reset.');
    } finally {
      setBusyMedia(false);
    }
  }

  const room = memory?.room;
  const guests: Entity[] = memory?.guests || [];
  const fixes: Entity[] = memory?.fixes || [];
  const openGuest = guests.filter(item => item.status !== 'Done').length;
  const openFixes = fixes.filter(item => !['Verified', 'Done'].includes(String(item.status))).length;
  const photoStyle = media?.configured && media.content_url ? { backgroundImage: `url(${media.content_url})` } : undefined;

  return <>
    <Top eyebrow="Property memory" title={room?.name || 'Room'} right={<Link className="btn secondary" href="/rooms">All rooms</Link>} />
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    {!memory && !error ? <div className="panel"><div className="empty">Loading room memory…</div></div> : null}
    {memory ? <>
      <section className="panel room-detail-media-panel">
        <div className="room-detail-photo" style={photoStyle} role="img" aria-label={`${room?.name || 'Room'} photo`} />
        <div className="room-detail-media-copy">
          <div><div className="eyebrow">Room image</div><h2>{room?.name}</h2><p className="muted">{media?.configured ? 'Using this room’s assigned photo.' : 'Using the Owner Appearance default room placeholder.'}</p></div>
          {isOwner ? <div className="room-media-controls">
            <label className="label">Choose room photo<input className="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
            <div className="toolbar"><button className="btn small" disabled={!file || busyMedia} onClick={uploadRoomPhoto}>{busyMedia ? 'Saving…' : media?.configured ? 'Replace photo' : 'Upload photo'}</button>{media?.configured ? <button className="btn small secondary" disabled={busyMedia} onClick={resetRoomPhoto}>Use default</button> : null}</div>
          </div> : null}
        </div>
      </section>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="panel"><div className="eyebrow">Space</div><h2>{room?.kind || 'Room'}</h2><Pill value={room?.status || 'Active'} /></div>
        <div className="panel"><div className="eyebrow">Open guest matters</div><h2>{openGuest}</h2></div>
        <div className="panel"><div className="eyebrow">Open maintenance</div><h2>{openFixes}</h2></div>
      </div>
      <div className="grid cols-2">
        <section className="panel">
          <div className="topbar"><div><div className="eyebrow">Service recovery</div><h2>Guest matters</h2></div><Link className="btn small secondary" href="/guests?create=1">New matter</Link></div>
          <div className="grid" style={{ marginTop: 12 }}>
            {guests.map(item => <div className="card" key={item.id}><strong>{item.title || item.guest_name || 'Guest matter'}</strong><div className="card-line"><Pill value={item.issue_type} /><Pill value={item.status} /><Pill value={item.urgency} /></div>{item.guest_name ? <span className="muted">Guest: {item.guest_name}</span> : null}{dateLabel(item.follow_up_at || item.updated_at) ? <span className="muted">{dateLabel(item.follow_up_at || item.updated_at)}</span> : null}</div>)}
            {!guests.length ? <div className="empty">No guest matters for this space.</div> : null}
          </div>
        </section>
        <section className="panel">
          <div className="topbar"><div><div className="eyebrow">Repair history</div><h2>Maintenance</h2></div><Link className="btn small secondary" href="/fixes?create=1">Report issue</Link></div>
          <div className="grid" style={{ marginTop: 12 }}>
            {fixes.map(item => <div className="card" key={item.id}><strong>{item.title || 'Maintenance item'}</strong><div className="card-line"><Pill value={item.status} /><Pill value={item.urgency} /></div>{item.technician_name ? <span className="muted">Assigned: {item.technician_name}</span> : null}{dateLabel(item.target_date || item.updated_at) ? <span className="muted">{dateLabel(item.target_date || item.updated_at)}</span> : null}</div>)}
            {!fixes.length ? <div className="empty">No maintenance history for this space.</div> : null}
          </div>
        </section>
      </div>
    </> : null}
  </>;
}
