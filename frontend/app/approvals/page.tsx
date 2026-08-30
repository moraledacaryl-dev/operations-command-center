'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Drawer } from '@/components/Drawer';
import { Tabs } from '@/components/Tabs';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [filter, setFilter] = useState('Pending');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const user = getStoredUser();
  const canDecide = hasCapability(user, 'make_decisions');
  const departmentId = getCurrentDepartmentId(user);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await api.list('approvals', {
        active: true,
        department_id: departmentId || '',
      }));
    } catch (err: any) {
      setError(err.message || 'Could not load approvals.');
    } finally {
      setLoading(false);
    }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items
      .filter(item => filter === 'All' || item.status === filter)
      .filter(item => !term || [item.title, item.source_type, item.note, item.decision_note, item.status].filter(Boolean).join(' ').toLowerCase().includes(term));
  }, [items, filter, query]);

  async function open(item: Entity) {
    setNote('');
    setError('');
    try {
      setSelected(await api.get('approvals', item.id));
    } catch (err: any) {
      setError(err.message || 'Could not open approval.');
    }
  }

  async function decide(status: 'Approved' | 'Rejected') {
    if (!selected || busy || !canDecide || selected.status !== 'Pending') return;
    if (status === 'Rejected' && !note.trim()) {
      setError('A rejection note is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.decideApproval(selected.id, status, { note: note.trim() || undefined });
      setSelected(null);
      setNote('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not complete the approval decision.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Top eyebrow="Decision queue" title="Approvals" right={<button className="btn secondary" onClick={() => void load()} disabled={loading || busy}>{loading ? 'Refreshing…' : 'Refresh'}</button>} />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}

    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="card-line"><Pill value={`${visible.length} visible`} /><span className="muted">Approvals are system-owned records. Decisions use the canonical workflow only.</span></div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <input className="input" placeholder="Search approvals" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      <Tabs values={['Pending', 'Approved', 'Rejected', 'All']} active={filter} onChange={setFilter} label="Approval status" />
    </section>

    <section className="panel">
      <div className="topbar"><div><div className="eyebrow">Canonical decisions</div><h2>Approval queue</h2></div></div>
      {loading ? <div className="empty">Loading approvals…</div> : visible.length ? <div className="grid cols-3">
        {visible.map(item => <button type="button" className="card" key={item.id} onClick={() => void open(item)} style={{ textAlign: 'left', width: '100%' }}>
          <div className="card-title">{item.title || 'Approval'}</div>
          <div className="card-line"><Pill value={item.status || 'Pending'} /><Pill value={item.priority || 'Normal'} />{item.source_type ? <Pill value={item.source_type} /> : null}</div>
          {item.note ? <div className="muted">{String(item.note).slice(0, 160)}</div> : null}
        </button>)}
      </div> : <div className="empty">No approvals match this view.</div>}
    </section>

    <Drawer item={selected} title="Approval decision" onClose={() => { if (!busy) setSelected(null); }}>
      {selected ? <>
        <section className="panel">
          <div className="card-line"><Pill value={selected.status || 'Pending'} /><Pill value={selected.priority || 'Normal'} /></div>
          <h2 style={{ marginTop: 12 }}>{selected.title || 'Approval'}</h2>
          {selected.note ? <p className="muted">{selected.note}</p> : null}
          <div className="grid cols-2" style={{ marginTop: 12 }}>
            <div className="card"><span className="muted">Requested by</span><b>{selected.requested_by_id || '—'}</b></div>
            <div className="card"><span className="muted">Created</span><b>{formatDate(selected.created_at)}</b></div>
            <div className="card"><span className="muted">Decided by</span><b>{selected.decided_by_id || '—'}</b></div>
            <div className="card"><span className="muted">Decision time</span><b>{formatDate(selected.decided_at)}</b></div>
          </div>
          {selected.decision_note ? <div className="card" style={{ marginTop: 12 }}><span className="muted">Decision note</span><p>{selected.decision_note}</p></div> : null}
        </section>

        {canDecide && selected.status === 'Pending' ? <section className="panel" style={{ marginTop: 16 }}>
          <h2>Decision</h2>
          <div className="form" style={{ marginTop: 12 }}>
            <textarea className="textarea" placeholder="Decision note. Required when rejecting." value={note} onChange={event => setNote(event.target.value)} disabled={busy} />
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button className="btn small" onClick={() => void decide('Approved')} disabled={busy}>{busy ? 'Saving…' : 'Approve'}</button>
              <button className="btn small secondary" onClick={() => void decide('Rejected')} disabled={busy || !note.trim()}>Reject</button>
            </div>
          </div>
        </section> : null}

        {!canDecide && selected.status === 'Pending' ? <div className="panel" style={{ marginTop: 16 }}><span className="muted">You can review this approval, but your session does not include decision authority.</span></div> : null}
      </> : null}
    </Drawer>
  </>;
}
