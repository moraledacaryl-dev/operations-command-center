'use client';

import { useEffect, useState } from 'react';
import { Top } from '@/components/Top';
import { getStoredUser } from '@/lib/session';

type MediaRow = {
  slot: string;
  label: string;
  configured: boolean;
  filename?: string | null;
  content_url?: string | null;
  updated_at?: string | null;
};

async function readRows(): Promise<MediaRow[]> {
  const response = await fetch('/api/property-media', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load property media.');
  return response.json();
}

export default function AppearancePage() {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const user = getStoredUser();
  const isOwner = String(user?.role || '').toLowerCase() === 'owner';

  async function load() {
    setRows(await readRows());
  }

  useEffect(() => { load().catch(err => setError(err.message)); }, []);

  async function upload(slot: string, file?: File) {
    if (!file || busy) return;
    setBusy(slot); setError(''); setSaved('');
    const form = new FormData();
    form.set('file', file);
    try {
      const response = await fetch(`/api/property-media/${encodeURIComponent(slot)}`, { method: 'POST', body: form, credentials: 'same-origin' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail || 'Could not upload this property image.');
      }
      await load();
      setSaved('Property image updated. Refreshing other open pages will use the new image.');
    } catch (err: any) {
      setError(err.message || 'Could not upload this property image.');
    } finally { setBusy(''); }
  }

  async function reset(slot: string) {
    if (busy) return;
    setBusy(slot); setError(''); setSaved('');
    try {
      const response = await fetch(`/api/property-media/${encodeURIComponent(slot)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok && response.status !== 204) throw new Error('Could not reset this property image.');
      await load();
      setSaved('Property image reset to the built-in fallback.');
    } catch (err: any) {
      setError(err.message || 'Could not reset this property image.');
    } finally { setBusy(''); }
  }

  if (!isOwner) return <><Top eyebrow="Administration" title="Appearance" /><div className="panel"><div className="empty">Only the owner can manage property appearance media.</div></div></>;

  return <>
    <Top eyebrow="Administration" title="Appearance & property media" />
    <section className="panel property-media-intro">
      <h2>Owner-managed website imagery</h2>
      <p className="muted">Replace global Hidden Oasis imagery without editing source code. Upload JPG, PNG, WebP, or other image types accepted by the existing secure upload validator. Maximum size is 10 MB. Room-specific photos remain managed with room records.</p>
    </section>

    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 14 }}>{error}</div> : null}
    {saved ? <div className="pill ok" role="status" style={{ marginBottom: 14 }}>{saved}</div> : null}

    <div className="grid cols-2 property-media-grid">
      {rows.map(row => <article className="panel property-media-card" key={row.slot}>
        <div className="property-media-preview" style={row.content_url ? { backgroundImage: `url(${row.content_url})` } : undefined}>
          {!row.content_url ? <span>Built-in fallback</span> : null}
        </div>
        <div>
          <span className="eyebrow">Global image</span>
          <h2>{row.label}</h2>
          <p className="muted">{row.configured ? row.filename : 'No custom image uploaded.'}</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label className="btn small">
            {busy === row.slot ? 'Uploading…' : row.configured ? 'Replace image' : 'Upload image'}
            <input type="file" accept="image/*" hidden disabled={!!busy} onChange={event => void upload(row.slot, event.target.files?.[0])} />
          </label>
          {row.configured ? <button className="btn small secondary" disabled={!!busy} onClick={() => void reset(row.slot)}>Use fallback</button> : null}
        </div>
      </article>)}
    </div>
  </>;
}
