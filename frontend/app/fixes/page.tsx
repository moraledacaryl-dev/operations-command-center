'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { workflowApi } from '@/lib/workflow-api';
import { Drawer } from '@/components/Drawer';
import { Tabs } from '@/components/Tabs';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { LoadingPanel } from '@/components/LoadingPanel';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';

const statuses = ['Open', 'Working', 'Done', 'Verified'];
const emptyForm: Entity = { title: '', room_area_id: '', urgency: 'Normal', problem: '', assigned_to_id: '' };

export default function MaintenancePage() {
  const [items, setItems] = useState<Entity[]>([]); const [rooms, setRooms] = useState<Entity[]>([]); const [people, setPeople] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null); const [showAdd, setShowAdd] = useState(false); const [filter, setFilter] = useState('Active');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [verificationNote, setVerificationNote] = useState(''); const [proofUrl, setProofUrl] = useState(''); const [reopenReason, setReopenReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Entity>({ ...emptyForm });
  const { departmentId, hydrated } = useActiveDepartment();
  const beginRequest = useLatestRequest();

  const openCreate = useCallback(() => setShowAdd(true), []);
  useCreateIntent(openCreate);

  function roomName(id?: number | string | null) { if (!id) return 'Location not recorded'; return rooms.find(room => Number(room.id) === Number(id))?.name || `Room / area #${id}`; }
  function personName(id?: number | string | null) { if (!id) return 'Unassigned'; return people.find(person => Number(person.id) === Number(id))?.name || `User #${id}`; }

  const load = useCallback(async () => {
    if (!hydrated) return;
    const request = beginRequest();
    setLoading(true);
    try {
      setError('');
      const [workItems, roomItems, meta] = await Promise.all([
        api.listAll('fixes', { active: true, department_id: departmentId || '' }, { signal: request.signal }),
        api.listAll('rooms', { active: false }, { signal: request.signal }),
        api.meta(),
      ]);
      if (!request.isCurrent()) return;
      setItems(workItems); setRooms(roomItems); setPeople(Array.isArray(meta.users) ? meta.users : []);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Maintenance work could not be loaded.');
    } finally { if (request.isCurrent()) setLoading(false); }
  }, [beginRequest, departmentId, hydrated]);

  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => items.filter(item => { if (filter === 'Active') return item.status !== 'Verified'; if (filter === 'Urgent') return ['Urgent','High'].includes(String(item.urgency)) && item.status !== 'Verified'; return filter === 'All' || item.status === filter; }), [items, filter]);

  async function createFix() { if (!String(form.title || '').trim() || busy || !hydrated) return; setBusy(true); try { await api.create('fixes', { title: String(form.title).trim(), room_area_id: form.room_area_id ? Number(form.room_area_id) : null, urgency: form.urgency, problem: String(form.problem || '').trim() || null, assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null, department_id: departmentId || null }); setForm({ ...emptyForm }); setShowAdd(false); await load(); } catch (err: any) { setError(err.message || 'Maintenance item could not be created.'); } finally { setBusy(false); } }
  async function transition(kind: 'start' | 'done') { if (!selected || busy) return; setBusy(true); try { const updated = kind === 'start' ? await workflowApi.startFix(selected.id) : await workflowApi.doneFix(selected.id); setSelected({ ...selected, ...updated }); await load(); } catch (err: any) { setError(err.message || 'Maintenance item could not be updated.'); } finally { setBusy(false); } }
  async function verify() { if (!selected || !verificationNote.trim() || busy) return; setBusy(true); try { const updated = await api.verifyFix(selected.id, { note: verificationNote.trim(), proof_url: proofUrl.trim() || undefined }); setSelected({ ...selected, ...updated }); setVerificationNote(''); setProofUrl(''); await load(); } catch (err: any) { setError(err.message || 'Maintenance item could not be verified.'); } finally { setBusy(false); } }
  async function reopen() { if (!selected || !reopenReason.trim() || busy) return; setBusy(true); try { const updated = await workflowApi.reopenFix(selected.id, { note: reopenReason.trim() }); setSelected({ ...selected, ...updated }); setReopenReason(''); await load(); } catch (err: any) { setError(err.message || 'Maintenance item could not be reopened.'); } finally { setBusy(false); } }

  const active = items.filter(item => item.status !== 'Verified').length; const working = items.filter(item => item.status === 'Working').length; const verifyCount = items.filter(item => item.status === 'Done').length;
  if (!hydrated || loading) return <><Top eyebrow="Repair execution" title="Maintenance" /><LoadingPanel label="Loading maintenance work…" /></>;
  return <>
    <Top eyebrow="Repair execution" title="Maintenance" right={<button data-testid="create-fix" className="btn" onClick={() => setShowAdd(value => !value)}>New maintenance item</button>} />
    <div className="grid cols-3 operational-kpis" style={{ marginBottom: 16 }}><div className="panel"><div className="eyebrow">Active</div><h2>{active}</h2></div><div className="panel"><div className="eyebrow">In progress</div><h2>{working}</h2></div><div className="panel"><div className="eyebrow">Awaiting verification</div><h2>{verifyCount}</h2></div></div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {showAdd ? <section className="panel" style={{ marginBottom: 16 }} data-testid="create-fix-form"><h2>Log maintenance work</h2><div className="form-grid" style={{ marginTop: 12 }}><label className="label">Work item<input className="input" value={String(form.title || '')} onChange={e => setForm({ ...form, title: e.target.value })} /></label><label className="label">Room / area<select className="select" value={String(form.room_area_id || '')} onChange={e => setForm({ ...form, room_area_id: e.target.value })}><option value="">Not assigned</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label className="label">Urgency<select className="select" value={String(form.urgency)} onChange={e => setForm({ ...form, urgency: e.target.value })}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label><label className="label">Assigned technician<select className="select" value={String(form.assigned_to_id || '')} onChange={e => setForm({ ...form, assigned_to_id: e.target.value })}><option value="">Unassigned</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div><label className="label">Problem / scope<textarea className="textarea" value={String(form.problem || '')} onChange={e => setForm({ ...form, problem: e.target.value })} /></label><div className="toolbar"><button className="btn" disabled={busy || !String(form.title || '').trim()} onClick={createFix}>{busy ? 'Saving…' : 'Create work item'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div></section> : null}
    <Tabs values={['Active','Urgent',...statuses,'All']} active={filter} onChange={setFilter} label="Maintenance filters" />
    <section className="panel maintenance-workspace"><div className="topbar"><div><div className="eyebrow">Property work orders</div><h2>Maintenance queue</h2></div><Pill value={`${visible.length} visible`} /></div><div className="maintenance-queue">{visible.map(item => <button type="button" className={`card maintenance-item ${['Urgent','High'].includes(String(item.urgency)) && item.status !== 'Verified' ? 'card-important' : ''}`} key={item.id} onClick={() => setSelected(item)} style={{ textAlign: 'left' }}><strong className="card-title">{item.title}</strong><span className="card-line"><Pill value={String(item.status || 'Open')} /><Pill value={String(item.urgency || 'Normal')} /></span><span className="muted">{roomName(item.room_area_id)}</span><span className="muted">Assigned: {personName(item.assigned_to_id)}</span></button>)}{!visible.length ? <div className="empty">No maintenance items in this view.</div> : null}</div>
    <Drawer item={selected} title="Maintenance work" onClose={() => !busy && setSelected(null)}>{selected ? <><section className="panel" style={{ marginBottom: 16 }}><div className="eyebrow">Work order</div><h2>{roomName(selected.room_area_id)}</h2><p>{selected.problem || selected.note || 'No scope recorded.'}</p><div className="card-line"><Pill value={String(selected.status || 'Open')} /><Pill value={String(selected.urgency || 'Normal')} /><Pill value={personName(selected.assigned_to_id)} /></div></section><section className="panel" style={{ marginBottom: 16 }}><h2>Work progression</h2><div className="toolbar">{selected.status === 'Open' ? <button className="btn small" disabled={busy} onClick={() => transition('start')}>Start work</button> : null}{selected.status === 'Working' ? <button className="btn small secondary" disabled={busy} onClick={() => transition('done')}>Mark done</button> : null}{selected.status === 'Verified' ? <span className="muted">Verified work has no normal Start/Done action.</span> : null}</div></section>{selected.status === 'Done' ? <section className="panel"><h2>Verify closure</h2><div className="form" style={{ marginTop: 12 }}><textarea className="textarea" placeholder="Verification note" value={verificationNote} onChange={e => setVerificationNote(e.target.value)} /><input className="input" placeholder="Proof URL optional" value={proofUrl} onChange={e => setProofUrl(e.target.value)} /><button className="btn" disabled={busy || !verificationNote.trim()} onClick={verify}>{busy ? 'Verifying…' : 'Verify work'}</button></div></section> : null}{selected.status === 'Verified' ? <section className="panel"><h2>Reopen verified work</h2><textarea className="textarea" placeholder="Reason required" value={reopenReason} onChange={e => setReopenReason(e.target.value)} /><button className="btn secondary" disabled={busy || !reopenReason.trim()} onClick={reopen}>Reopen</button></section> : null}</> : null}</Drawer>
  </>;
}
