'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Drawer } from '@/components/Drawer';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';

const statuses = ['Open', 'Working', 'Done', 'Verified'];
const emptyForm: Entity = { title: '', room_area_id: '', urgency: 'Normal', problem: '', assigned_to_id: '' };

export default function MaintenancePage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [rooms, setRooms] = useState<Entity[]>([]);
  const [people, setPeople] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('Active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verificationNote, setVerificationNote] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [form, setForm] = useState<Entity>({ ...emptyForm });
  const departmentId = getCurrentDepartmentId(getStoredUser());

  function roomName(roomAreaId?: number | string | null) {
    if (!roomAreaId) return 'Location not recorded';
    return rooms.find(room => Number(room.id) === Number(roomAreaId))?.name || `Room / area #${roomAreaId}`;
  }

  function personName(userId?: number | string | null) {
    if (!userId) return 'Unassigned';
    return people.find(person => Number(person.id) === Number(userId))?.name || `User #${userId}`;
  }

  async function load() {
    try {
      setError('');
      const [workItems, roomItems, meta] = await Promise.all([
        api.list('fixes', { active: true, department_id: departmentId || '' }),
        api.list('rooms', { active: false }),
        api.meta(),
      ]);
      setItems(workItems);
      setRooms(roomItems);
      setPeople(Array.isArray(meta.users) ? meta.users : []);
    } catch (err: any) {
      setError(err.message || 'Maintenance work could not be loaded.');
    }
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => items.filter(item => {
    if (filter === 'Active') return item.status !== 'Verified';
    if (filter === 'Urgent') return ['Urgent', 'High'].includes(String(item.urgency)) && item.status !== 'Verified';
    return filter === 'All' || item.status === filter;
  }), [items, filter]);

  async function createFix() {
    if (!String(form.title || '').trim() || busy) return;
    setBusy(true);
    try {
      await api.create('fixes', {
        title: String(form.title).trim(),
        room_area_id: form.room_area_id ? Number(form.room_area_id) : null,
        urgency: form.urgency,
        problem: String(form.problem || '').trim() || null,
        assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
        status: 'Open',
        department_id: departmentId || null,
      });
      setForm({ ...emptyForm });
      setShowAdd(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Maintenance item could not be created.');
    } finally { setBusy(false); }
  }

  async function move(status: string) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api.status('fixes', selected.id, status);
      setSelected({ ...selected, status });
      await load();
    } catch (err: any) {
      setError(err.message || 'Maintenance item could not be updated.');
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!selected || !verificationNote.trim() || busy) return;
    setBusy(true);
    try {
      const updated = await api.verifyFix(selected.id, { note: verificationNote.trim(), proof_url: proofUrl.trim() || undefined });
      setSelected({ ...selected, ...updated, status: 'Verified' });
      setVerificationNote('');
      setProofUrl('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Maintenance item could not be verified.');
    } finally { setBusy(false); }
  }

  const active = items.filter(item => item.status !== 'Verified').length;
  const working = items.filter(item => item.status === 'Working').length;
  const verifyCount = items.filter(item => item.status === 'Done').length;

  return <>
    <Top eyebrow="Repair execution" title="Maintenance" right={<button className="btn" onClick={() => setShowAdd(value => !value)}>New maintenance item</button>} />
    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="panel"><div className="eyebrow">Active</div><h2>{active}</h2></div>
      <div className="panel"><div className="eyebrow">In progress</div><h2>{working}</h2></div>
      <div className="panel"><div className="eyebrow">Awaiting verification</div><h2>{verifyCount}</h2></div>
    </div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {showAdd ? <section className="panel" style={{ marginBottom: 16 }}>
      <h2>Log maintenance work</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Work item<input className="input" value={String(form.title || '')} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label className="label">Room / area<select className="select" value={String(form.room_area_id || '')} onChange={e => setForm({ ...form, room_area_id: e.target.value })}><option value="">Not assigned</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <label className="label">Urgency<select className="select" value={String(form.urgency)} onChange={e => setForm({ ...form, urgency: e.target.value })}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        <label className="label">Assigned technician<select className="select" value={String(form.assigned_to_id || '')} onChange={e => setForm({ ...form, assigned_to_id: e.target.value })}><option value="">Unassigned</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      </div>
      <label className="label">Problem / scope<textarea className="textarea" value={String(form.problem || '')} onChange={e => setForm({ ...form, problem: e.target.value })} /></label>
      <p className="muted">Target dates are not stored by the current maintenance model, so they are intentionally not collected here.</p>
      <div className="toolbar"><button className="btn" disabled={busy || !String(form.title || '').trim()} onClick={createFix}>{busy ? 'Saving…' : 'Create work item'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <div className="tabs" style={{ marginBottom: 16 }}>{['Active', 'Urgent', ...statuses, 'All'].map(value => <button className={`tab ${filter === value ? 'active' : ''}`} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div>
    <div className="grid cols-3">
      {visible.map(item => <button type="button" className={`card ${['Urgent', 'High'].includes(String(item.urgency)) && item.status !== 'Verified' ? 'card-important' : ''}`} key={item.id} onClick={() => setSelected(item)} style={{ textAlign: 'left' }}>
        <strong className="card-title">{item.title}</strong>
        <span className="card-line"><Pill value={String(item.status || 'Open')} /><Pill value={String(item.urgency || 'Normal')} /></span>
        <span className="muted">{roomName(item.room_area_id)}</span>
        <span className="muted">Assigned: {personName(item.assigned_to_id)}</span>
      </button>)}
      {!visible.length ? <div className="empty">No maintenance items in this view.</div> : null}
    </div>
    <Drawer item={selected} title="Maintenance work" onClose={() => setSelected(null)}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Work order</div>
          <h2>{roomName(selected.room_area_id)}</h2>
          <p>{selected.problem || selected.note || 'No scope recorded.'}</p>
          <div className="card-line"><Pill value={String(selected.status || 'Open')} /><Pill value={String(selected.urgency || 'Normal')} /><Pill value={personName(selected.assigned_to_id)} /></div>
        </section>
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Work progression</h2>
          <div className="toolbar">
            <button className="btn small" disabled={busy || selected.status === 'Working'} onClick={() => move('Working')}>Start work</button>
            <button className="btn small secondary" disabled={busy || selected.status === 'Done'} onClick={() => move('Done')}>Mark done</button>
          </div>
        </section>
        {selected.status === 'Done' ? <section className="panel">
          <h2>Verify closure</h2>
          <div className="form" style={{ marginTop: 12 }}>
            <textarea className="textarea" placeholder="Verification note" value={verificationNote} onChange={e => setVerificationNote(e.target.value)} />
            <input className="input" placeholder="Proof URL optional" value={proofUrl} onChange={e => setProofUrl(e.target.value)} />
            <button className="btn" disabled={busy || !verificationNote.trim()} onClick={verify}>{busy ? 'Verifying…' : 'Verify work'}</button>
          </div>
        </section> : null}
      </> : null}
    </Drawer>
  </>;
}
