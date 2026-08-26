'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Drawer } from '@/components/Drawer';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';

function dateLabel(value?: string) {
  if (!value) return 'No follow-up set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No follow-up set';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

const emptyForm: Entity = {
  title: '', guest_name: '', room_area_id: '', issue_type: 'Request', urgency: 'Normal', note: '', follow_up_date: '',
};

export default function GuestMattersPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [rooms, setRooms] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('Active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Entity>({ ...emptyForm });
  const { departmentId, hydrated } = useActiveDepartment();
  const beginRequest = useLatestRequest();

  const openCreate = useCallback(() => setShowAdd(true), []);
  useCreateIntent(openCreate);

  function roomName(roomAreaId?: number | string | null) {
    if (!roomAreaId) return 'Room not recorded';
    return rooms.find(room => Number(room.id) === Number(roomAreaId))?.name || `Room / area #${roomAreaId}`;
  }

  const load = useCallback(async () => {
    if (!hydrated) return;
    const request = beginRequest();
    try {
      setError('');
      const [guestItems, roomItems] = await Promise.all([
        api.list('guests', { active: true, department_id: departmentId || '' }, { signal: request.signal }),
        api.list('rooms', { active: false }, { signal: request.signal }),
      ]);
      if (!request.isCurrent()) return;
      setItems(guestItems);
      setRooms(roomItems);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Guest matters could not be loaded.');
    }
  }, [beginRequest, departmentId, hydrated]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items.filter(item => {
    if (filter === 'Active') return item.status !== 'Done';
    if (filter === 'Urgent') return ['Urgent', 'High'].includes(String(item.urgency));
    return filter === 'All' || item.status === filter;
  }), [items, filter]);

  async function createMatter() {
    if (!String(form.title || '').trim() || busy || !hydrated) return;
    setBusy(true);
    try {
      await api.create('guests', {
        title: String(form.title).trim(), guest_name: String(form.guest_name || '').trim() || null,
        room_area_id: form.room_area_id ? Number(form.room_area_id) : null, issue_type: form.issue_type,
        urgency: form.urgency, note: String(form.note || '').trim() || null,
        follow_up_date: form.follow_up_date || null, status: 'Open', department_id: departmentId || null,
      });
      setForm({ ...emptyForm }); setShowAdd(false); await load();
    } catch (err: any) { setError(err.message || 'Guest matter could not be created.'); }
    finally { setBusy(false); }
  }

  async function move(status: string) {
    if (!selected || busy) return; setBusy(true);
    try { await api.status('guests', selected.id, status); setSelected({ ...selected, status }); await load(); }
    catch (err: any) { setError(err.message || 'Guest matter could not be updated.'); }
    finally { setBusy(false); }
  }

  async function createFix() {
    if (!selected || busy) return; setBusy(true);
    try { await api.guestCreateFix(selected.id, { department_id: selected.department_id || departmentId, note: selected.note || selected.title }); setSelected(await api.get('guests', selected.id)); await load(); }
    catch (err: any) { setError(err.message || 'Maintenance work could not be created.'); }
    finally { setBusy(false); }
  }

  const active = items.filter(item => item.status !== 'Done').length;
  const urgent = items.filter(item => item.status !== 'Done' && ['Urgent', 'High'].includes(String(item.urgency))).length;
  const follow = items.filter(item => item.status === 'Follow').length;

  return <>
    <Top eyebrow="Service recovery" title="Guest matters" right={<button data-testid="create-guest" className="btn" onClick={() => setShowAdd(value => !value)}>New guest matter</button>} />
    <div className="grid cols-3" style={{ marginBottom: 16 }}><div className="panel"><div className="eyebrow">Active</div><h2>{active}</h2></div><div className="panel"><div className="eyebrow">Urgent</div><h2>{urgent}</h2></div><div className="panel"><div className="eyebrow">Follow-up</div><h2>{follow}</h2></div></div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {showAdd ? <section className="panel" style={{ marginBottom: 16 }} data-testid="create-guest-form">
      <h2>Log guest matter</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Matter<input className="input" value={String(form.title || '')} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label className="label">Guest<input className="input" value={String(form.guest_name || '')} onChange={e => setForm({ ...form, guest_name: e.target.value })} /></label>
        <label className="label">Room / area<select className="select" value={String(form.room_area_id || '')} onChange={e => setForm({ ...form, room_area_id: e.target.value })}><option value="">Not assigned</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <label className="label">Type<select className="select" value={String(form.issue_type)} onChange={e => setForm({ ...form, issue_type: e.target.value })}><option>Request</option><option>Complaint</option><option>Room</option><option>Food</option><option>Payment</option><option>Checkout</option><option>Other</option></select></label>
        <label className="label">Urgency<select className="select" value={String(form.urgency)} onChange={e => setForm({ ...form, urgency: e.target.value })}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        <label className="label">Follow-up<input className="input" type="datetime-local" value={String(form.follow_up_date || '')} onChange={e => setForm({ ...form, follow_up_date: e.target.value })} /></label>
      </div>
      <label className="label">Recovery action / context<textarea className="textarea" value={String(form.note || '')} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
      <div className="toolbar"><button className="btn" disabled={busy || !String(form.title || '').trim()} onClick={createMatter}>{busy ? 'Saving…' : 'Save matter'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <div className="tabs" style={{ marginBottom: 16 }}>{['Active', 'Urgent', 'Open', 'Follow', 'Done', 'All'].map(value => <button className={`tab ${filter === value ? 'active' : ''}`} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div>
    <div className="grid cols-3">{visible.map(item => <button type="button" className={`card ${['Urgent', 'High'].includes(String(item.urgency)) && item.status !== 'Done' ? 'card-important' : ''}`} key={item.id} onClick={() => setSelected(item)} style={{ textAlign: 'left' }}><strong className="card-title">{item.title}</strong><span className="card-line"><Pill value={String(item.status || 'Open')} /><Pill value={String(item.urgency || 'Normal')} /><Pill value={String(item.issue_type || 'Guest')} /></span><span className="muted">{item.guest_name || 'Guest not recorded'} · {roomName(item.room_area_id)}</span><span className="muted">Follow-up: {dateLabel(item.follow_up_date)}</span></button>)}{!visible.length ? <div className="empty">No guest matters in this view.</div> : null}</div>
    <Drawer item={selected} title="Guest matter" onClose={() => setSelected(null)}>
      {selected ? <><section className="panel" style={{ marginBottom: 16 }}><div className="eyebrow">Service recovery</div><h2>{selected.guest_name || 'Guest'} · {roomName(selected.room_area_id)}</h2><p>{selected.note || 'No recovery note yet.'}</p><p className="muted">Follow-up: {dateLabel(selected.follow_up_date)}</p><div className="card-line"><Pill value={String(selected.issue_type || 'Guest')} /><Pill value={String(selected.urgency || 'Normal')} /><Pill value={String(selected.status || 'Open')} /></div></section><section className="panel"><h2>Next action</h2><div className="toolbar"><button className="btn small" disabled={busy || selected.status === 'Follow'} onClick={() => move('Follow')}>Needs follow-up</button><button className="btn small secondary" disabled={busy} onClick={createFix}>Create maintenance</button><button className="btn small secondary" disabled={busy || selected.status === 'Done'} onClick={() => move('Done')}>Resolve</button></div></section></> : null}
    </Drawer>
  </>;
}
