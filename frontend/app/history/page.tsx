'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

const kinds = ['', 'projects', 'tasks', 'shift-notes', 'guests', 'fixes', 'posts', 'approvals', 'memos', 'submissions'];

export default function HistoryPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  async function load() { setItems(await api.history({ q, kind })); }
  useEffect(() => { load(); }, [kind]);
  return (
    <>
      <Top eyebrow="Search" title="History" right={<button className="btn secondary" onClick={load}>Go</button>} />
      <div className="toolbar">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
        <select className="select" style={{ maxWidth: 220 }} value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(k => <option value={k} key={k}>{k || 'All'}</option>)}</select>
      </div>
      <div className="grid cols-3">
        {items.length ? items.map(item => (
          <div className="card" key={`${item.kind}-${item.id}`}>
            <div className="card-title">{item.title || item.name}</div>
            <div className="card-line"><Pill value={item.kind} /><Pill value={item.status || item.review_status} /><Pill value={item.archive_reason} /></div>
            <span className="muted">{String(item.note || item.message || item.caption || '').slice(0, 90)}</span>
          </div>
        )) : <div className="empty">No history yet</div>}
      </div>
    </>
  );
}
