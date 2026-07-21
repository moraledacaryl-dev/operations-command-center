'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';

const sections = [
  ['external', 'Imported'], ['requests', 'Requests'], ['approvals', 'Approvals'], ['submissions', 'Inbox'], ['posts', 'Posts'], ['fixes', 'Verify']
];

const sourceLabels: Record<string, string> = {
  hidden_oasis_staff_payroll: 'Staff',
  dedicated_pos_cloud: 'POS',
  inventory_procurement: 'Inventory',
  accounting_program: 'Accounting',
};

const priorityRank: Record<string, number> = {
  urgent: 0,
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function resourceFor(kind: string) {
  if (kind === 'Imported') return 'external-review-items';
  return kind === 'Inbox' ? 'submissions' : kind === 'Verify' ? 'fixes' : kind.toLowerCase();
}

function sourceName(item: Entity) {
  const source = String(item.source_app || item.external_source || '').trim();
  return sourceLabels[source] || source || 'Imported';
}

function readableSummary(item: Entity) {
  const direct = item.summary || item.reason || item.note || item.caption || item.problem;
  if (direct) return String(direct);
  if (!item.payload_json) return '';
  try {
    const parsed = typeof item.payload_json === 'string' ? JSON.parse(item.payload_json) : item.payload_json;
    if (parsed.summary) return String(parsed.summary);
    if (parsed.payload?.summary) return String(parsed.payload.summary);
    if (parsed.payload?.note) return String(parsed.payload.note);
    if (parsed.payload?.counts && typeof parsed.payload.counts === 'object') {
      return Object.entries(parsed.payload.counts).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ');
    }
  } catch {
    return String(item.payload_json);
  }
  return '';
}

function eventLabel(item: Entity) {
  const event = String(item.event_type || item.source_type || '').trim();
  return event ? event.replaceAll('.', ' ').replaceAll('_', ' ') : '';
}

function itemDate(item: Entity) {
  const raw = item.created_at || item.updated_at || item.submitted_at || item.received_at;
  if (!raw) return '';
  const date = new Date(String(raw));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function searchableText(item: Entity, kind: string) {
  return [
    kind,
    sourceName(item),
    item.title,
    item.name,
    item.status,
    item.review_status,
    item.priority,
    item.urgency,
    eventLabel(item),
    readableSummary(item),
  ].filter(Boolean).join(' ').toLowerCase();
}

function ReviewCard({ item, kind, onOpen, disabled }: { item: Entity; kind: string; onOpen: () => void; disabled?: boolean }) {
  const summary = readableSummary(item);
  const date = itemDate(item);
  return <div className="card">
    <div className="card-title">{item.title || item.name || 'Item'}</div>
    <div className="card-line">
      <Pill value={kind === 'Imported' ? sourceName(item) : kind} />
      <Pill value={item.status || item.review_status} />
      <Pill value={item.urgency || item.priority || eventLabel(item)} />
    </div>
    {kind === 'Imported' && eventLabel(item) ? <div className="muted" style={{ textTransform: 'capitalize' }}>{eventLabel(item)}</div> : null}
    {summary ? <div className="muted">{summary.slice(0, 160)}</div> : null}
    {date ? <div className="muted" style={{ fontSize: 12 }}>{date}</div> : null}
    <div className="toolbar tight">
      <button className="btn small secondary" onClick={onOpen} disabled={disabled}>Open</button>
    </div>
  </div>;
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<Entity>({});
  const [selected, setSelected] = useState<Entity | null>(null);
  const [selectedKind, setSelectedKind] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setError('');
    setLoading(true);
    try {
      const user = getStoredUser();
      const id = getCurrentDepartmentId(user);
      setQueue(await api.reviewQueue({ department_id: id || '' }));
    } catch (err: any) {
      setError(err.message || 'Could not load the review queue.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredQueue = useMemo(() => {
    const next: Entity = {};
    sections.forEach(([key, label]) => {
      const rows = [...(queue[key] || [])]
        .filter((item: Entity) => key !== 'external' || sourceFilter === 'All' || sourceName(item) === sourceFilter)
        .filter((item: Entity) => !normalizedQuery || searchableText(item, label).includes(normalizedQuery))
        .sort((a: Entity, b: Entity) => {
          const aRank = priorityRank[String(a.priority || a.urgency || 'normal').toLowerCase()] ?? 2;
          const bRank = priorityRank[String(b.priority || b.urgency || 'normal').toLowerCase()] ?? 2;
          if (aRank !== bRank) return aRank - bRank;
          const aDate = new Date(String(a.created_at || a.updated_at || 0)).getTime() || Number(a.id || 0);
          const bDate = new Date(String(b.created_at || b.updated_at || 0)).getTime() || Number(b.id || 0);
          return bDate - aDate;
        });
      next[key] = rows;
    });
    return next;
  }, [queue, sourceFilter, normalizedQuery]);

  const sourceCounts = (queue.external || []).reduce((counts: Record<string, number>, item: Entity) => {
    const source = sourceName(item);
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});

  const totalCount = sections.reduce((total, [key]) => total + (queue[key] || []).length, 0);
  const visibleCount = sections.reduce((total, [key]) => total + (filteredQueue[key] || []).length, 0);

  async function open(kind: string, item: Entity) {
    if (submitting) return;
    setError('');
    setSelectedKind(kind);
    setNote('');
    try {
      setSelected(await api.get(resourceFor(kind), item.id));
    } catch (err: any) {
      setError(err.message || 'Could not open item.');
    }
  }

  async function move(status: string) {
    if (!selected || submitting) return;
    if (['Rejected', 'Verified'].includes(status) && !note.trim()) {
      setError('Add a decision note first.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (selectedKind === 'Approvals') {
        await api.decideApproval(selected.id, status, { note: note.trim(), create_task: status === 'Approved' });
      } else if (selectedKind === 'Imported') {
        if (status === 'Seen') await api.externalMarkSeen(selected.id, { note: note.trim() || undefined });
        else if (status === 'Rejected') await api.externalReject(selected.id, { note: note.trim() });
        else if (status === 'Task') await api.externalCreateTask(selected.id, { note: note.trim() || undefined });
        else if (status === 'Approval') await api.externalCreateApproval(selected.id, { note: note.trim() || undefined });
      } else if (selectedKind === 'Verify') {
        await api.verifyFix(selected.id, { note: note.trim() });
      } else {
        await api.status(resourceFor(selectedKind), selected.id, status, note.trim() || undefined);
      }
      setSelected(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not update review item.');
    } finally {
      setSubmitting(false);
    }
  }

  return <>
    <Top eyebrow="Decide" title="Review" right={<button className="btn secondary" onClick={load} disabled={loading || submitting}>{loading ? 'Refreshing…' : 'Refresh'}</button>} />
    {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="card-line">
        <Pill value={`${totalCount} pending`} />
        <span className="muted">Operational decisions from this workspace and every connected app.</span>
      </div>
      <div className="form" style={{ marginTop: 12 }}>
        <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title, source, status, priority, or summary" />
      </div>
      <div className="toolbar tight" style={{ marginTop: 12, marginBottom: 0 }}>
        {['All', 'Staff', 'POS', 'Inventory', 'Accounting'].map(source => (
          <button key={source} className={`btn small ${sourceFilter === source ? '' : 'secondary'}`} onClick={() => setSourceFilter(source)} disabled={loading || submitting}>
            {source} {source === 'All' ? (queue.external || []).length : sourceCounts[source] || 0}
          </button>
        ))}
        {(normalizedQuery || sourceFilter !== 'All') ? <button className="btn small secondary" onClick={() => { setQuery(''); setSourceFilter('All'); }}>Clear filters</button> : null}
      </div>
      {(normalizedQuery || sourceFilter !== 'All') ? <div className="muted" style={{ marginTop: 10 }}>Showing {visibleCount} of {totalCount} pending items.</div> : null}
    </div>
    {loading ? <div className="panel"><div className="empty">Loading review queue…</div></div> : <div className="grid cols-2">
      {sections.map(([key, label]) => <section className="panel" key={key}>
        <div className="card-line" style={{ justifyContent: 'space-between' }}>
          <h2>{label}{key === 'external' && sourceFilter !== 'All' ? ` · ${sourceFilter}` : ''}</h2>
          <Pill value={(filteredQueue[key] || []).length} />
        </div>
        <div className="grid" style={{ marginTop: 12 }}>
          {(filteredQueue[key] || []).length ? (filteredQueue[key] || []).map((item: Entity) => <ReviewCard key={`${key}-${item.id}`} item={item} kind={label} disabled={submitting} onOpen={() => open(label, item)} />) : <div className="empty">{normalizedQuery || sourceFilter !== 'All' ? 'No matching items' : 'All clear'}</div>}
        </div>
      </section>)}
    </div>}
    <Drawer item={selected} title={`${selectedKind} review`} onClose={() => { if (!submitting) setSelected(null); }}>
      {selectedKind === 'Imported' && selected ? <div className="panel" style={{ marginBottom: 12 }}>
        <h2>Source context</h2>
        <div className="card-line" style={{ marginTop: 12 }}>
          <Pill value={sourceName(selected)} />
          <Pill value={selected.priority || selected.urgency || 'Normal'} />
          <Pill value={selected.status || selected.review_status} />
        </div>
        {eventLabel(selected) ? <p className="muted" style={{ textTransform: 'capitalize' }}>{eventLabel(selected)}</p> : null}
        {readableSummary(selected) ? <p style={{ lineHeight: 1.6 }}>{readableSummary(selected)}</p> : null}
        {itemDate(selected) ? <p className="muted">Received {itemDate(selected)}</p> : null}
      </div> : null}
      <div className="panel">
        <h2>Decision</h2>
        <div className="form" style={{ marginTop: 12 }}>
          <textarea className="textarea" placeholder="Decision note" value={note} onChange={e => setNote(e.target.value)} disabled={submitting} />
          <div className="toolbar" style={{ marginBottom: 0 }}>
            {selectedKind === 'Requests' || selectedKind === 'Approvals' ? <><button className="btn small" disabled={submitting} onClick={() => move('Approved')}>{submitting ? 'Saving…' : 'Approve'}</button><button className="btn small secondary" disabled={submitting} onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Imported' ? <><button className="btn small" disabled={submitting} onClick={() => move('Seen')}>{submitting ? 'Saving…' : 'Seen'}</button><button className="btn small secondary" disabled={submitting} onClick={() => move('Task')}>Create task</button><button className="btn small secondary" disabled={submitting} onClick={() => move('Approval')}>Create approval</button><button className="btn small secondary" disabled={submitting} onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Verify' ? <button className="btn small" disabled={submitting} onClick={() => move('Verified')}>{submitting ? 'Saving…' : 'Verify'}</button> : null}
            {selectedKind === 'Inbox' ? <><button className="btn small" disabled={submitting} onClick={() => move('Accepted')}>{submitting ? 'Saving…' : 'Accept'}</button><button className="btn small secondary" disabled={submitting} onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Posts' ? <><button className="btn small" disabled={submitting} onClick={() => move('OK')}>{submitting ? 'Saving…' : 'OK'}</button><button className="btn small secondary" disabled={submitting} onClick={() => move('Fix')}>Needs fix</button></> : null}
          </div>
        </div>
      </div>
    </Drawer>
  </>;
}
