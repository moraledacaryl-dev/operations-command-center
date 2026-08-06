'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Drawer } from '@/components/Drawer';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';

const stages = ['Draft', 'Review', 'Approved', 'Planned', 'Done'];

export default function RequestsPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [requestType, setRequestType] = useState('General');
  const [urgency, setUrgency] = useState('Normal');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('Open');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const departmentId = getCurrentDepartmentId(getStoredUser());

  async function load() {
    try {
      setError('');
      setItems(await api.list('requests', { active: true, department_id: departmentId || '' }));
    } catch (err: any) {
      setError(err.message || 'Requests could not be loaded.');
    }
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => items.filter(item => {
    if (filter === 'Open') return !['Done', 'Rejected'].includes(String(item.status));
    if (filter === 'All') return true;
    return item.status === filter;
  }).sort((a, b) => {
    const rank: Record<string, number> = { Urgent: 0, Normal: 1, Low: 2 };
    return (rank[a.urgency] ?? 1) - (rank[b.urgency] ?? 1) || Number(a.id) - Number(b.id);
  }), [items, filter]);

  async function createRequest() {
    if (!title.trim() || !reason.trim() || busy) return;
    setBusy(true);
    try {
      await api.create('requests', {
        title: title.trim(), request_type: requestType, urgency, reason: reason.trim(),
        status: 'Draft', department_id: departmentId || null,
      });
      setTitle(''); setReason(''); setRequestType('General'); setUrgency('Normal'); setShowAdd(false); await load();
    } catch (err: any) { setError(err.message || 'Request could not be created.'); }
    finally { setBusy(false); }
  }

  async function submitForReview() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api.submitRequestApproval(selected.id, { department_id: selected.department_id || departmentId, note: note.trim() || selected.reason || '' });
      setSelected(null); setNote(''); await load();
    } catch (err: any) { setError(err.message || 'Request could not be submitted.'); }
    finally { setBusy(false); }
  }

  async function move(status: string) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api.status('requests', selected.id, status, note.trim() || undefined);
      setSelected(null); setNote(''); await load();
    } catch (err: any) { setError(err.message || 'Request could not be updated.'); }
    finally { setBusy(false); }
  }

  const pending = items.filter(item => item.status === 'Review').length;
  const approved = items.filter(item => ['Approved', 'Planned'].includes(item.status)).length;
  const urgent = items.filter(item => item.urgency === 'Urgent' && !['Done', 'Rejected'].includes(item.status)).length;

  return <>
    <Top eyebrow="Proposal pipeline" title="Requests" right={<button className="btn" onClick={() => setShowAdd(value => !value)}>Add</button>} />
    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="panel"><div className="eyebrow">Awaiting decision</div><h2>{pending}</h2></div>
      <div className="panel"><div className="eyebrow">Approved / planned</div><h2>{approved}</h2></div>
      <div className="panel"><div className="eyebrow">Urgent open</div><h2>{urgent}</h2></div>
    </div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {showAdd ? <section className="panel" style={{ marginBottom: 16 }}>
      <h2>New request</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Request<input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="label">Type<select className="select" value={requestType} onChange={e => setRequestType(e.target.value)}>{['General','Equipment','Policy','Process','Staffing','Supply','Marketing','Maintenance','Event','Other'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="label">Priority<select className="select" value={urgency} onChange={e => setUrgency(e.target.value)}><option>Low</option><option>Normal</option><option>Urgent</option></select></label>
      </div>
      <label className="label">Business reason<textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="toolbar"><button className="btn" disabled={busy || !title.trim() || !reason.trim()} onClick={createRequest}>{busy ? 'Saving…' : 'Create draft'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <div className="tabs" style={{ marginBottom: 16 }}>{['Open','Draft','Review','Approved','Planned','Done','Rejected','All'].map(status => <button key={status} className={`tab ${filter === status ? 'active' : ''}`} onClick={() => setFilter(status)}>{status}</button>)}</div>
    <div className="grid cols-3">
      {visible.map(item => <button type="button" key={item.id} className={`card ${item.urgency === 'Urgent' ? 'card-important' : ''}`} onClick={() => setSelected(item)} style={{ textAlign: 'left' }}>
        <strong className="card-title">{item.title}</strong>
        <span className="card-line"><Pill value={item.status} /><Pill value={item.urgency || 'Normal'} /><Pill value={item.request_type || 'General'} /></span>
        <span className="muted">{String(item.reason || '').slice(0, 150)}</span>
        {item.requested_by_name || item.created_by_name ? <span className="muted">Requested by {item.requested_by_name || item.created_by_name}</span> : null}
      </button>)}
      {!visible.length ? <div className="empty">No requests in this view.</div> : null}
    </div>
    <Drawer item={selected} title="Request" onClose={() => !busy && setSelected(null)}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}><div className="eyebrow">Decision context</div><h2>{selected.title}</h2><p>{selected.reason || 'No business reason recorded.'}</p><div className="card-line"><Pill value={selected.status} /><Pill value={selected.urgency || 'Normal'} /><Pill value={selected.request_type || 'General'} /></div></section>
        <section className="panel"><h2>Next action</h2><textarea className="textarea" placeholder="Decision or implementation note" value={note} onChange={e => setNote(e.target.value)} disabled={busy} /><div className="toolbar">
          {selected.status === 'Draft' ? <button className="btn" disabled={busy} onClick={submitForReview}>{busy ? 'Submitting…' : 'Send for review'}</button> : null}
          {selected.status === 'Approved' ? <button className="btn" disabled={busy} onClick={() => move('Planned')}>Mark planned</button> : null}
          {selected.status === 'Planned' ? <button className="btn" disabled={busy} onClick={() => move('Done')}>Mark implemented</button> : null}
          {!['Done','Rejected'].includes(selected.status) ? <button className="btn secondary" disabled={busy} onClick={() => move('Rejected')}>Reject / close</button> : null}
        </div></section>
      </> : null}
    </Drawer>
  </>;
}
