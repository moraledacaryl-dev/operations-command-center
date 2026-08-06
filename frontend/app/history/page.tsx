'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

const kinds = ['', 'projects', 'tasks', 'shift-notes', 'guests', 'fixes', 'posts', 'approvals', 'memos', 'submissions'];

function formatDate(value?: string) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function HistoryPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [items, setItems] = useState<Entity[]>([]);
  const [q, setQ] = useState(search.get('q') || '');
  const [kind, setKind] = useState(search.get('kind') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(nextQ = q, nextKind = kind) {
    setLoading(true);
    setError('');
    try {
      setItems(await api.history({ q: nextQ, kind: nextKind }));
      const params = new URLSearchParams();
      if (nextQ.trim()) params.set('q', nextQ.trim());
      if (nextKind) params.set('kind', nextKind);
      router.replace(`/history${params.toString() ? `?${params}` : ''}`);
    } catch (err: any) {
      setError(err.message || 'History could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(q, kind); }, []);

  const grouped = useMemo(() => items.reduce((groups: Record<string, Entity[]>, item) => {
    const month = item.archived_at || item.completed_at || item.updated_at || item.created_at;
    const date = month ? new Date(month) : null;
    const key = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(date) : 'Earlier records';
    (groups[key] ||= []).push(item);
    return groups;
  }, {}), [items]);

  return <>
    <Top eyebrow="Operational archive" title="History" right={<button className="btn secondary" onClick={() => load()} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>} />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input className="input" placeholder="Search title, note, owner, or archive reason" value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') load(); }} />
        <select className="select" value={kind} onChange={event => { setKind(event.target.value); load(q, event.target.value); }}>{kinds.map(value => <option value={value} key={value}>{value ? value.replaceAll('-', ' ') : 'All record types'}</option>)}</select>
        {(q || kind) ? <button className="btn secondary" onClick={() => { setQ(''); setKind(''); load('', ''); }}>Clear</button> : null}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>{items.length} archived or completed records. Filters are saved in the URL.</p>
    </section>
    {loading ? <div className="panel"><div className="empty">Loading history…</div></div> : Object.entries(grouped).map(([month, rows]) => <section className="panel" key={month} style={{ marginBottom: 16 }}>
      <div className="topbar"><h2>{month}</h2><Pill value={String(rows.length)} /></div>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        {rows.map(item => <article className="card" key={`${item.kind}-${item.id}`}>
          <div className="card-title">{item.title || item.name || 'Archived record'}</div>
          <div className="card-line"><Pill value={item.kind} /><Pill value={item.status || item.review_status || 'Completed'} />{item.archive_reason ? <Pill value={item.archive_reason} /> : null}</div>
          <span className="muted">{String(item.note || item.message || item.caption || item.reason || '').slice(0, 160) || 'No summary recorded.'}</span>
          <div className="card-line" style={{ marginTop: 8 }}>
            {item.department_name ? <span className="muted">Department: {item.department_name}</span> : null}
            {item.owner_name || item.assignee_name ? <span className="muted">Owner: {item.owner_name || item.assignee_name}</span> : null}
          </div>
          <span className="muted">Finalized {formatDate(item.archived_at || item.completed_at || item.updated_at || item.created_at)}</span>
        </article>)}
      </div>
    </section>)}
    {!loading && !items.length ? <div className="panel"><div className="empty">No history matches these filters.</div></div> : null}
  </>;
}
