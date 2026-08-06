'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Drawer } from '@/components/Drawer';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';

const statuses = ['Open', 'Working', 'Done', 'Verified'];

function dateLabel(value?: string) {
  if (!value) return 'No target date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No target date';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export default function MaintenancePage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('Active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verificationNote, setVerificationNote] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [form, setForm] = useState<Entity>({ title: '', location: '', urgency: 'Normal', problem: '', assigned_to_name: '', due_date: '' });
  const departmentId = getCurrentDepartmentId(getStoredUser());

  async function load() {
    try {
      setError('');
      setItems(await api.list('fixes', { active: true, department_id: departmentId || '' }));
    } catch (err: any) {
      setError(err.message || 'Maintenance work could not be loaded.');
    }
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => items.filter(item => {
    if (filter === 'Active') return !['Verified'].includes(String(item.status));
    if (filter === 'Urgent') return ['Urgent', 'High'].includes(String(item.urgency)) && item.status !== 'Verified';
    return filter === 'All' || item.status === filter;
  }), [items, filter]);

  async function createFix() {
    if (!String(form.title || '').trim() || busy) return;
    setBusy(true);
    try {
      await api.create('fixes', { ...form, status: 'Open', department_id: departmentId || null });
      setForm({ title: '', location: '', urgency: 'Normal', problem: '', assigned_to_name: '', due_date: '' });
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
        <label className="label">Location<input className="input" value={String(form.location || '')} onChange={e => setForm({ ...form, location: e.target.value })} /></label>
        <label className="label">Urgency<select className="select" value={String(form.urgency)} onChange={e => setForm({ ...form, urgency: e.target.value })}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        <label className="label">Assigned technician<input className="input" value={String(form.assigned_to_name || '')} onChange={e => setForm({ ...form, assigned_to_name: e.target.value })} /></label>
        <label className="label">Target date<input className="input" type="date" value={String(form.due_date || '')} onChange={e => setForm({ ...form, due_date: e.target.value })} /></label>
      </div>
      <label className="label">Problem / scope<textarea className="textarea" value={String(form.problem || '')} onChange={e => setForm({ ...form, problem: e.target.value })} /></label>
      <div className="toolbar"><button className="btn" disabled={busy || !String(form.title || '').trim()} onClick={createFix}>{busy ? 'Saving…' : 'Create work item'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <div className="tabs" style={{ marginBottom: 16 }}>{['Active', 'Urgent', ...statuses, 'All'].map(value => <button className={`tab ${filter === value ? 'active' : ''}`} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div>
    <div className="grid cols-3">
      {visible.map(item => <button type="button" className={`card ${['Urgent', 'High'].includes(String(item.urgency)) && item.status !== 'Verified' ? 'card-important' : ''}`} key={item.id} onClick={() => setSelected(item)} style={{ textAlign: 'left' }}>
        <strong className="card-title">{item.title}</strong>
        <span className="card-line"><Pill value={String(item.status || 'Open')} /><Pill value={String(item.urgency || 'Normal')} /></span>
        <span className="muted">{item.location || item.room_name || 'Location not recorded'}</span>
        <span className="muted">Assigned: {item.assigned_to_name || item.assignee_name || 'Unassigned'} · {dateLabel(item.due_date)}</span>
      </button>)}
      {!visible.length ? <div className="empty">No maintenance items in this view.</div> : null}
    </div>
    <Drawer item={selected} title="Maintenance work" onClose={() => setSelected(null)}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Work order</div>
          <h2>{selected.location || selected.room_name || 'Unassigned location'}</h2>
          <p>{selected.problem || selected.note || 'No scope recorded.'}</p>
          <div className="card-line"><Pill value={String(selected.status || 'Open')} /><Pill value={String(selected.urgency || 'Normal')} /><Pill value={String(selected.assigned_to_name || selected.assignee_name || 'Unassigned')} /></div>
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
