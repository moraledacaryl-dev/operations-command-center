'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';

const sections = [
  ['external', 'Imported'], ['requests', 'Requests'], ['approvals', 'Approvals'], ['submissions', 'Inbox'], ['posts', 'Posts'], ['fixes', 'Verify']
];

function resourceFor(kind: string) {
  if (kind === 'Imported') return 'external-review-items';
  return kind === 'Inbox' ? 'submissions' : kind === 'Verify' ? 'fixes' : kind.toLowerCase();
}

function sourceLabel(item: Entity, kind: string) {
  if (kind !== 'Imported') return kind;
  const source = String(item.source_app || item.external_source || '').toLowerCase();
  if (source.includes('staff')) return 'Staff';
  if (source.includes('pos')) return 'POS';
  if (source.includes('accounting')) return 'Accounting';
  return 'Imported';
}

function itemSummary(item: Entity) {
  return String(item.summary || item.reason || item.note || item.caption || item.problem || '').slice(0, 120);
}

function ReviewCard({ item, kind, onOpen }: { item: Entity; kind: string; onOpen: () => void }) {
  return <div className="card">
    <div className="card-title">{item.title || item.name || 'Item'}</div>
    <div className="card-line"><Pill value={sourceLabel(item, kind)} /><Pill value={item.status || item.review_status} /><Pill value={item.urgency || item.priority || item.event_type || item.source_type} /></div>
    {itemSummary(item) ? <div className="muted">{itemSummary(item)}</div> : null}
    <div className="toolbar tight">
      <button className="btn small secondary" onClick={onOpen}>Open</button>
    </div>
  </div>;
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<Entity>({});
  const [selected, setSelected] = useState<Entity | null>(null);
  const [selectedKind, setSelectedKind] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  async function load() { const user = getStoredUser(); const id = getCurrentDepartmentId(user); setQueue(await api.reviewQueue({ department_id: id || '' })); }
  useEffect(() => { load(); }, []);
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
    <div className="panel" style={{ marginBottom: 16 }}><div className="card-line"><Pill value="One queue" /><span className="muted">Imported items, approvals, fixes, posts, and requests.</span></div></div>
    <div className="grid cols-2">
      {sections.map(([key, label]) => <section className="panel" key={key}>
        <h2>{label}</h2>
        <div className="grid" style={{ marginTop: 12 }}>
          {(queue[key] || []).length ? (queue[key] || []).map((item: Entity) => <ReviewCard key={`${key}-${item.id}`} item={item} kind={label} onOpen={() => open(label, item)} />) : <div className="empty">All clear</div>}
        </div>
      </section>)}
    </div>
    <Drawer item={selected} title={`${selectedKind} review`} onClose={() => setSelected(null)}>
      <div className="panel">
        <h2>Decision</h2>
        {selectedKind === 'Imported' ? (
          <div className="card-line" style={{ marginTop: 10 }}>
            <Pill value={sourceLabel(selected, selectedKind)} />
            <Pill value={selected.event_type} />
          </div>
        ) : null}
        <div className="form" style={{ marginTop: 12 }}>
          <textarea className="textarea" placeholder="Decision note" value={note} onChange={e => setNote(e.target.value)} />
          <div className="toolbar" style={{ marginBottom: 0 }}>
            {selectedKind === 'Requests' || selectedKind === 'Approvals' ? <><button className="btn small" onClick={() => move('Approved')}>Approve</button><button className="btn small secondary" onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Imported' ? <><button className="btn small" onClick={() => move('Seen')}>Seen</button><button className="btn small secondary" onClick={() => move('Task')}>Task</button><button className="btn small secondary" onClick={() => move('Approval')}>Approval</button><button className="btn small secondary" onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Verify' ? <button className="btn small" onClick={() => move('Verified')}>Verify</button> : null}
            {selectedKind === 'Inbox' ? <><button className="btn small" onClick={() => move('Accepted')}>Accept</button><button className="btn small secondary" onClick={() => move('Rejected')}>Reject</button></> : null}
            {selectedKind === 'Posts' ? <><button className="btn small" onClick={() => move('OK')}>OK</button><button className="btn small secondary" onClick={() => move('Fix')}>Needs fix</button></> : null}
          </div>
        </div>
      </div>
    </Drawer>
  </>;
}
