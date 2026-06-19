'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';

const kinds = ['', 'projects', 'tasks', 'shift-notes', 'guests', 'fixes', 'posts', 'requests', 'approvals', 'memos', 'submissions', 'talk', 'docs', 'routines'];

function archiveDate(item: Entity) {
  return item.archived_at || item.completed_at || item.updated_at || item.created_at || '';
}

function isWithinDate(item: Entity, from: string, to: string) {
  const value = String(archiveDate(item)).slice(0, 10);
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function csvEscape(value: any) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export default function HistoryPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setItems(await api.history({ q, kind, limit: 500 }));
    } catch (err: any) {
      setError(err.message || 'Could not load history.');
    }
  }

  useEffect(() => { load(); }, [kind]);

  async function open(item: Entity) {
    setError('');
    try {
      const fresh = await api.get(item.kind, item.id);
      setSelected({ ...fresh, kind: item.kind });
    } catch (err: any) {
      setError(err.message || 'Could not open history item.');
    }
  }

  const visible = items.filter(item => isWithinDate(item, from, to));
  const grouped = visible.reduce((acc: Record<string, number>, item) => {
    acc[item.kind] = (acc[item.kind] || 0) + 1;
    return acc;
  }, {});

  function exportCsv() {
    const header = ['kind', 'title', 'status', 'archived_at', 'archive_reason'];
    const rows = visible.map(item => [
      item.kind,
      item.title || item.name,
      item.status || item.review_status,
      archiveDate(item),
      item.archive_reason,
    ]);
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `operations-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Top eyebrow="Search" title="History" right={<div className="toolbar tight"><button className="btn secondary" onClick={load}>Go</button><button className="btn secondary" onClick={exportCsv} disabled={!visible.length}>Export</button></div>} />
      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div className="card-line">
            <Pill value={`${visible.length} items`} />
            {Object.entries(grouped).slice(0, 8).map(([name, count]) => <Pill key={name} value={`${name}: ${count}`} />)}
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <input className="input" style={{ maxWidth: 300 }} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
          <select className="select" style={{ maxWidth: 220 }} value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(k => <option value={k} key={k}>{k || 'All'}</option>)}</select>
          <input className="input" type="date" style={{ maxWidth: 170 }} value={from} onChange={e => setFrom(e.target.value)} />
          <input className="input" type="date" style={{ maxWidth: 170 }} value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </section>
      <div className="grid cols-3">
        {visible.length ? visible.map(item => (
          <div className="card" key={`${item.kind}-${item.id}`} onClick={() => open(item)}>
            <div className="card-title">{item.title || item.name}</div>
            <div className="card-line"><Pill value={item.kind} /><Pill value={item.status || item.review_status} /><Pill value={item.archive_reason} /><Pill value={String(archiveDate(item)).slice(0, 10)} /></div>
            <span className="muted">{String(item.note || item.message || item.caption || item.reason || item.problem || '').slice(0, 90)}</span>
          </div>
        )) : <div className="empty">No history yet</div>}
      </div>
      <Drawer item={selected} title={selected ? `${selected.kind || 'History'} #${selected.id}` : undefined} onClose={() => setSelected(null)} />
    </>
  );
}
