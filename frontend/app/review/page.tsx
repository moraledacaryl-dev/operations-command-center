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

function ReviewCard({ item, kind, onOpen }: { item: Entity; kind: string; onOpen: () => void }) {
  const summary = readableSummary(item);
  return <div className="card">
    <div className="card-title">{item.title || item.name || 'Item'}</div>
    <div className="card-line">
      <Pill value={kind === 'Imported' ? sourceName(item) : kind} />
      <Pill value={item.status || item.review_status} />
      <Pill value={item.urgency || item.priority || eventLabel(item)} />
    </div>
    {kind === 'Imported' && eventLabel(item) ? <div className="muted" style={{ textTransform: 'capitalize' }}>{eventLabel(item)}</div> : null}
    {summary ? <div className="muted">{summary.slice(0, 160)}</div> : null}
    <div className="toolbar tight">
      <button className="btn small secondary" onClick={onOpen}>Open</button>
    </div>
  </div>;
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<Entity>({});
  const [selected, setSelected] = useState<Entity | null>(null);
  const [selectedKind, setSelectedKind] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const user = getStoredUser();
    const id = getCurrentDepartmentId(user);
    setQueue(await api.reviewQueue({ department_id: id || '' }));
  }

  useEffect(() => { load(); }, []);

  const imported = useMemo(() => {
    const rows = [...(queue.external || [])];
    return rows
      .filter((item: Entity) => sourceFilter === 'All' || sourceName(item) === sourceFilter)
      .sort((a: Entity, b: Entity) => {
        const aRank = priorityRank[String(a.priority || a.urgency || 'normal').toLowerCase()] ?? 2;
        const bRank = priorityRank[String(b.priority || b.urgency || 'normal').toLowerCase()] ?? 2;
        if (aRank !== bRank) return aRank - bRank;
        return Number(b.id || 0) - Number(a.id || 0);
      });
  }, [queue.external, sourceFilter]);

  const visibleQueue = { ...queue, external: imported };
  const sourceCounts = (queue.external || []).reduce((counts: Record<string, number>, item: Entity) => {
    const source = sourceName(item);
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});

  async function open(kind: string, item: Entity) {
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
    if (!selected) return;
    if (['Rejected', 'Verified'].includes(status) && !note.trim()) {
      setError('Add a decision note first.');
      return;
    }
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
    }
  }

  return <>
    <Top eyebrow="Decide" title="Review" right={<button className="btn secondary" onClick={load}>Refresh</button>} />
    {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="card-line"><Pill value="One queue" /><span className="muted">Operational decisions from this workspace and every connected app.</span></div>
      <div className="toolbar tight" style={{ marginTop: 12, marginBottom: 0 }}>
        {['All', 'Staff', 'POS', 'Inventory', 'Accounting'].map(source => (
          <button key={source} className={`btn small ${sourceFilter === source ? '' : 'secondary'}`} onClick={() => setSourceFilter(source)}>
            {source} {source === 'All' ? (queue.external || []).length : sourceCounts[source] || 0}
          </button>
        ))}
      </div>
    </div>
    <div className="grid cols-2">
      {sections.map(([key, label]) => <section className="panel" key={key}>
        <h2>{label}{key === 'external' && sourceFilter !== 'All' ? ` · ${sourceFilter}` : ''}</h2>
        <div className="grid" style={{ marginTop: 12 }}>
          {(visibleQueue[key] || []).length ? (visibleQueue[key] || []).map((item: Entity) => <ReviewCard key={`${key}-${item.id}`} item={item} kind={label} onOpen={() => open(label, item)} />) : <div className="empty">All clear</div>}
        </div>
      </section>)}
    </div>
    <Drawer item={selected} title={`${selectedKind} review`} onClose={() => setSelected(null)}>
      {selectedKind === 'Imported' && selected ? <div className="panel" style={{ marginBottom: 12 }}>
        <h2>Source context</h2>
        <div className="card-line" style={{ marginTop: 12 }}>
          <Pill value={sourceName(selected)} />
          <Pill value={selected.priority || selected.urgency || 'Normal'} />
          <Pill value={selected.status || selected.review_status} />
        </div>
        {eventLabel(selected) ? <p className="muted" style={{ textTransform: 'capitalize' }}>{eventLabel(selected)}</p> : null}
        {readableSummary(selected) ? <p style={{ lineHeight: 1.6 }}>{readableSummary(selected)}</p> : null}
      </div> : null}
      <div className="panel">
        <h2>Decision</h2>
        <div className="form" style={{ marginTop: 12 }}>
          <textarea className="textarea" placeholder="Decision note" value={note} onChange={e => setNote(e.target.value)} />
          <div className="toolbar" style={{ marginBottom: 0 }}>
            {selectedKind === 'Requests' || selectedKind === 'Approvals' ? <><button className="btn small" onClick={() => move('Approved')}>Approve</button><button className="btn small secondary" onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Imported' ? <><button className="btn small" onClick={() => move('Seen')}>Seen</button><button className="btn small secondary" onClick={() => move('Task')}>Create task</button><button className="btn small secondary" onClick={() => move('Approval')}>Create approval</button><button className="btn small secondary" onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Verify' ? <button className="btn small" onClick={() => move('Verified')}>Verify</button> : null}
            {selectedKind === 'Inbox' ? <><button className="btn small" onClick={() => move('Accepted')}>Accept</button><button className="btn small secondary" onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Posts' ? <><button className="btn small" onClick={() => move('OK')}>OK</button><button className="btn small secondary" onClick={() => move('Fix')}>Needs fix</button></> : null}
          </div>
        </div>
      </div>
    </Drawer>
  </>;
}
