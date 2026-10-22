'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { workflowApi } from '@/lib/workflow-api';
import { Drawer } from '@/components/Drawer';
import { Tabs } from '@/components/Tabs';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { Icon } from '@/components/Icon';
import { WorkCard } from '@/components/WorkCard';
import { WorkspaceStats } from '@/components/WorkspaceStats';

import { LoadingPanel } from '@/components/LoadingPanel';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';
import { getStoredUser } from '@/lib/session';
import { hasCapability } from '@/lib/capabilities';

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
  const [loading, setLoading] = useState(true);
  const { departmentId, hydrated } = useActiveDepartment();
  const canManageWork = hasCapability(getStoredUser(), 'manage_department');
  const beginRequest = useLatestRequest();

  const openCreate = useCallback(() => {
    if (hasCapability(getStoredUser(), 'manage_department')) setShowAdd(true);
  }, []);
  useCreateIntent(openCreate);

  const load = useCallback(async () => {
    if (!hydrated) return;
    const request = beginRequest();
    setLoading(true);
    try {
      setError('');
      const rows = await api.listAll('requests', { active: false, department_id: departmentId || '' }, { signal: request.signal });
      if (request.isCurrent()) setItems(rows);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Requests could not be loaded.');
    } finally { if (request.isCurrent()) setLoading(false); }
  }, [beginRequest, departmentId, hydrated]);

  useEffect(() => { void load(); }, [load]);

  const activeItems = items.filter(item => !item.hidden_from_active);
  const visible = useMemo(() => items.filter(item => {
    if (filter === 'All') return true;
    if (item.hidden_from_active) return false;
    if (filter === 'Open') return !['Done', 'Rejected'].includes(String(item.status));
    return item.status === filter;
  }).sort((a, b) => {
    const rank: Record<string, number> = { Urgent: 0, Normal: 1, Low: 2 };
    return (rank[a.urgency] ?? 1) - (rank[b.urgency] ?? 1) || Number(a.id) - Number(b.id);
  }), [items, filter]);

  async function createRequest() {
    if (!title.trim() || !reason.trim() || busy || !hydrated) return;
    setBusy(true);
    try {
      await api.create('requests', { title: title.trim(), request_type: requestType, urgency, reason: reason.trim(), department_id: departmentId || null });
      setTitle(''); setReason(''); setRequestType('General'); setUrgency('Normal'); setShowAdd(false); await load();
    } catch (err: any) { setError(err.message || 'Request could not be created.'); }
    finally { setBusy(false); }
  }

  async function submitForReview() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api.submitRequestApproval(selected.id, { note: note.trim() || selected.reason || '' });
      setSelected(null); setNote(''); await load();
    } catch (err: any) { setError(err.message || 'Request could not be submitted.'); }
    finally { setBusy(false); }
  }

  async function plan() {
    if (!selected || busy) return;
    setBusy(true);
    try { await workflowApi.planRequest(selected.id, { note: note.trim() || undefined }); setSelected(null); setNote(''); await load(); }
    catch (err: any) { setError(err.message || 'Request could not be planned.'); }
    finally { setBusy(false); }
  }

  async function complete() {
    if (!selected || busy) return;
    setBusy(true);
    try { await workflowApi.completeRequest(selected.id, { note: note.trim() || undefined }); setSelected(null); setNote(''); await load(); }
    catch (err: any) { setError(err.message || 'Request could not be completed.'); }
    finally { setBusy(false); }
  }

  const pending = activeItems.filter(item => item.status === 'Review').length;
  const approved = activeItems.filter(item => ['Approved', 'Planned'].includes(item.status)).length;
  const urgent = activeItems.filter(item => item.urgency === 'Urgent' && !['Done', 'Rejected'].includes(item.status)).length;

  if (!hydrated || loading) return <><Top title="Requests" /><LoadingPanel label="Loading requests and decisions…" /></>;

  return <div className="ops-module">
    <Top title="Requests" right={canManageWork ? <button data-testid="create-request" className="btn" onClick={() => setShowAdd(value => !value)}><Icon name="plus" />New request</button> : null} />
    <WorkspaceStats items={[
      { label: 'For review', value: error ? null : pending, icon: 'review' },
      { label: 'Approved / planned', value: error ? null : approved, icon: 'request' },
      { label: 'Urgent', value: error ? null : urgent, icon: 'clock', attention: true },
    ]} />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {canManageWork && showAdd ? <section className="panel" style={{ marginBottom: 16 }}>
      <h2>New request</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Request<input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="label">Type<select className="select" value={requestType} onChange={e => setRequestType(e.target.value)}>{['General','Equipment','Policy','Process','Staffing','Supply','Marketing','Maintenance','Event','Other'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="label">Priority<select className="select" value={urgency} onChange={e => setUrgency(e.target.value)}><option>Low</option><option>Normal</option><option>Urgent</option></select></label>
      </div>
      <label className="label">Business reason<textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="toolbar"><button className="btn" disabled={busy || !title.trim() || !reason.trim()} onClick={createRequest}>{busy ? 'Saving…' : 'Create draft'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <section>
    <Tabs values={['Open','Draft','Review','Approved','Planned','Done','Rejected','All']} active={filter} onChange={setFilter} label="Request status" />
    <div className="ops-card-grid">
      {visible.map(item => <WorkCard key={item.id} icon="request" accent="blue" title={item.title} description={item.reason} attention={!item.hidden_from_active && item.urgency === 'Urgent'} meta={<><Pill value={item.status} />{item.hidden_from_active ? <Pill value="Archived" /> : null}{item.urgency !== 'Normal' ? <Pill value={item.urgency} /> : null}</>} footer={<><span>{item.request_type || 'General'}</span><span>{item.hidden_from_active ? 'View archived request' : 'View request'}</span></>} onOpen={() => { setNote(''); setSelected(item); }} />)}
    </div>
    {!visible.length ? <div className="empty"><Icon name="request" />No requests in this view.</div> : null}</section>
    <Drawer item={selected} title={selected?.title || "Request"} onClose={() => !busy && setSelected(null)}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}><h2>Business reason</h2><p>{selected.reason || 'No business reason recorded.'}</p><div className="card-line"><Pill value={selected.request_type || 'General'} /></div></section>
        {selected.hidden_from_active ? <section className="panel" role="status"><h2>Archived request</h2><p className="muted">This is a historical record. Reconcile its archive state before taking further workflow action.</p></section> : <section className="panel"><h2>Next action</h2><textarea className="textarea" placeholder="Implementation note" value={note} onChange={e => setNote(e.target.value)} disabled={busy || !canManageWork} /><div className="toolbar">
          {canManageWork && selected.status === 'Draft' ? <button className="btn" disabled={busy} onClick={submitForReview}>{busy ? 'Submitting…' : 'Send for review'}</button> : null}
          {selected.status === 'Review' ? <span className="muted">Decision is made from the Approval workflow.</span> : null}
          {canManageWork && selected.status === 'Approved' ? <button className="btn" disabled={busy} onClick={plan}>Plan implementation</button> : null}
          {canManageWork && selected.status === 'Planned' ? <button className="btn" disabled={busy} onClick={complete}>Mark implemented</button> : null}
          {['Done','Rejected'].includes(selected.status) ? <span className="muted">This request is closed.</span> : null}
        </div></section>}
      </> : null}
    </Drawer>
  </div>;
}
