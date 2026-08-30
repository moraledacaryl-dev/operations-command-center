'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Drawer } from '@/components/Drawer';
import { Tabs } from '@/components/Tabs';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';

function formatStamp(value?: string) {
  if (!value) return 'Time not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export default function ShiftPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [shift, setShift] = useState('AM');
  const [category, setCategory] = useState('Other');
  const [urgency, setUrgency] = useState('Normal');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('Unresolved');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionNote, setActionNote] = useState('');
  const { departmentId, hydrated } = useActiveDepartment();
  const beginRequest = useLatestRequest();

  const openCreate = useCallback(() => setShowAdd(true), []);
  useCreateIntent(openCreate);

  const load = useCallback(async () => {
    if (!hydrated) return;
    const request = beginRequest();
    try {
      setError('');
      const rows = await api.list('shift-notes', { active: true, department_id: departmentId || '' }, { signal: request.signal });
      if (request.isCurrent()) setItems(rows);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Shift handover could not be loaded.');
    }
  }, [beginRequest, departmentId, hydrated]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => items.filter(item => {
    if (filter === 'Unresolved') return !['Done'].includes(String(item.status));
    if (filter === 'Urgent') return item.urgency === 'Urgent' && item.status !== 'Done';
    if (filter === 'All') return true;
    return item.shift === filter;
  }).sort((a, b) => new Date(String(b.created_at || b.updated_at || 0)).getTime() - new Date(String(a.created_at || a.updated_at || 0)).getTime()), [items, filter]);

  async function createNote() {
    if (!title.trim() || !note.trim() || busy || !hydrated) return;
    setBusy(true);
    try {
      await api.create('shift-notes', { title: title.trim(), shift, category, urgency, note: note.trim(), status: 'New', department_id: departmentId || null });
      setTitle(''); setNote(''); setCategory('Other'); setUrgency('Normal'); setShowAdd(false); await load();
    } catch (err: any) { setError(err.message || 'Handover note could not be created.'); }
    finally { setBusy(false); }
  }

  async function move(action: string) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api.workflowAction('shift-notes', selected.id, action, { note: actionNote.trim() || null });
      setActionNote('');
      setSelected(null); await load();
    } catch (err: any) { setError(err.message || 'Handover note could not be updated.'); }
    finally { setBusy(false); }
  }

  const unresolved = items.filter(item => item.status !== 'Done').length;
  const urgent = items.filter(item => item.urgency === 'Urgent' && item.status !== 'Done').length;
  const follow = items.filter(item => item.status === 'Follow').length;

  return <>
    <Top eyebrow="Live handover" title="Shift handover" right={<button data-testid="create-shift" className="btn" onClick={() => setShowAdd(value => !value)}>Add</button>} />
    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="panel"><div className="eyebrow">Unresolved</div><h2>{unresolved}</h2></div>
      <div className="panel"><div className="eyebrow">Urgent</div><h2>{urgent}</h2></div>
      <div className="panel"><div className="eyebrow">Needs follow-up</div><h2>{follow}</h2></div>
    </div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {showAdd ? <section className="panel" style={{ marginBottom: 16 }} data-testid="create-shift-form">
      <h2>New handover note</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Title<input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="label">Shift<select className="select" value={shift} onChange={e => setShift(e.target.value)}><option>AM</option><option>PM</option><option>Night</option></select></label>
        <label className="label">Category<select className="select" value={category} onChange={e => setCategory(e.target.value)}>{['Guest','Room','Fix','Supply','Payment','Event','Staff','Other'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="label">Priority<select className="select" value={urgency} onChange={e => setUrgency(e.target.value)}><option>Low</option><option>Normal</option><option>Urgent</option></select></label>
      </div>
      <label className="label">Handover detail<textarea className="textarea" value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="toolbar"><button className="btn" disabled={busy || !title.trim() || !note.trim()} onClick={createNote}>{busy ? 'Saving…' : 'Publish handover'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
    </section> : null}
    <Tabs values={['Unresolved','Urgent','AM','PM','Night','All']} active={filter} onChange={setFilter} label="Shift note filters" />
    <div className="grid">
      {visible.map(item => <button type="button" className={`card ${item.urgency === 'Urgent' && item.status !== 'Done' ? 'card-important' : ''}`} key={item.id} onClick={async () => { try { setSelected(await api.get('shift-notes', item.id)); } catch (err: any) { setError(err.message || 'Handover note could not be opened.'); } }} style={{ textAlign: 'left' }}>
        <span className="card-line"><Pill value={item.shift || 'Shift'} /><Pill value={item.category || 'Other'} /><Pill value={item.status || 'New'} />{item.urgency === 'Urgent' ? <Pill value="Urgent" /> : null}</span>
        <strong className="card-title">{item.title}</strong>
        <span>{String(item.note || '').slice(0, 220)}</span>
        <span className="muted">{formatStamp(item.created_at || item.updated_at)}{item.created_by_name ? ` · ${item.created_by_name}` : ''}</span>
      </button>)}
      {!visible.length ? <div className="empty">No handover notes in this view.</div> : null}
    </div>
    <Drawer item={selected} title="Handover note" onClose={() => !busy && setSelected(null)}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}><div className="card-line"><Pill value={selected.shift || 'Shift'} /><Pill value={selected.category || 'Other'} /><Pill value={selected.status || 'New'} /></div><h2>{selected.title}</h2><p style={{ lineHeight: 1.6 }}>{selected.note}</p><p className="muted">Recorded {formatStamp(selected.created_at || selected.updated_at)}</p></section>
        <section className="panel"><h2>Handover action</h2>{(selected.allowed_actions || []).includes('reopen') ? <label className="label">Reopen reason<textarea className="textarea" value={actionNote} onChange={event => setActionNote(event.target.value)} /></label> : null}<div className="toolbar">
          {(selected.allowed_actions || []).map((action: string) => <button className={action === 'acknowledge' ? 'btn' : 'btn secondary'} disabled={busy || (action === 'reopen' && !actionNote.trim())} key={action} onClick={() => move(action)}>{({ acknowledge: 'Acknowledge', 'follow-up-new': 'Carry forward', 'follow-up-seen': 'Carry forward', 'resolve-new': 'Resolve', 'resolve-seen': 'Resolve', 'resolve-follow': 'Resolve', reopen: 'Reopen' } as Record<string, string>)[action] || action}</button>)}
        </div></section>
      </> : null}
    </Drawer>
  </>;
}
