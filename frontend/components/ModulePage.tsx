'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { ModuleConfig, Field } from '@/lib/config';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';
import { getStoredUser } from '@/lib/session';
import { Top } from './Top';
import { Pill } from './Pill';
import { Drawer } from './Drawer';

const terminalStatuses = new Set(['Done', 'Verified', 'Approved', 'Rejected', 'Archived']);
const priorityRank: Record<string, number> = { Urgent: 0, High: 0, Normal: 1, Low: 2 };

function defaultData(fields: Field[]) {
  const data: Entity = {};
  fields.forEach(f => {
    if (f.key === 'status' && f.options?.[0]) data[f.key] = f.options[0];
    else if (f.key === 'priority' || f.key === 'urgency') data[f.key] = 'Normal';
    else data[f.key] = '';
  });
  return data;
}

function FieldInput({ field, value, onChange }: { field: Field; value: any; onChange: (v: any) => void }) {
  if (field.type === 'select') return <select className="select" value={value || ''} onChange={e => onChange(e.target.value)}>{field.options?.map(o => <option key={o}>{o}</option>)}</select>;
  if (field.type === 'textarea') return <textarea className="textarea" value={value || ''} onChange={e => onChange(e.target.value)} />;
  return <input className="input" type={field.type || 'text'} value={value || ''} onChange={e => onChange(e.target.value)} />;
}

function dueState(item: Entity) {
  if (!item.due_date || terminalStatuses.has(item.status)) return '';
  const due = new Date(`${item.due_date}T23:59:59`);
  const today = new Date();
  if (due.getTime() < today.getTime()) return 'Overdue';
  if (due.toDateString() === today.toDateString()) return 'Due today';
  return '';
}

function itemOwner(item: Entity) {
  return item.assignee_name || item.owner_name || item.created_by_name || item.assigned_to_name || item.employee_name || '';
}

function ItemCard({ item, meta, onOpen }: { item: Entity; meta: string[]; onOpen: () => void }) {
  const due = dueState(item);
  const important = item.priority === 'Urgent' || item.urgency === 'Urgent' || due === 'Overdue' || ['Review', 'Pending', 'New', 'Follow'].includes(item.status || item.review_status || '');
  const owner = itemOwner(item);
  const detail = item.note || item.problem || item.caption || item.reason || item.body || item.checklist;
  return (
    <button type="button" className={`card ${important ? 'card-important' : ''}`} onClick={onOpen} style={{ textAlign: 'left', width: '100%' }}>
      <div className="card-title">{item.title || item.name || item.body || 'Untitled'}</div>
      <div className="card-line">
        {meta.map(m => item[m] ? <Pill key={m} value={String(item[m]).slice(0, 24)} /> : null)}
        {due ? <Pill value={due} /> : null}
      </div>
      {owner ? <div className="muted" style={{ fontSize: 12 }}>Owner: {owner}</div> : null}
      {detail ? <div className="muted" style={{ fontSize: 13 }}>{String(detail).slice(0, 112)}</div> : null}
    </button>
  );
}

function StatusRail({ statuses, current }: { statuses: string[]; current?: string }) {
  return <div className="status-rail">{statuses.map(status => <span key={status} className={status === current ? 'current' : ''}>{status}</span>)}</div>;
}

export function ModulePage({ config }: { config: ModuleConfig }) {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [data, setData] = useState<Entity>(() => defaultData(config.fields));
  const [editData, setEditData] = useState<Entity>({});
  const [filter, setFilter] = useState(config.filters[0] || 'All');
  const [q, setQ] = useState('');
  const [comment, setComment] = useState('');
  const [workflowNote, setWorkflowNote] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { departmentId: currentDeptId, hydrated } = useActiveDepartment();
  const beginRequest = useLatestRequest();
  const activeStatus = filter !== 'All' ? filter : '';
  const user = getStoredUser();
  const canManage = hasCapability(user, 'manage_department');
  const canDecide = hasCapability(user, 'make_decisions');

  const openCreate = useCallback(() => { if (canManage) setShowAdd(true); }, [canManage]);
  useCreateIntent(openCreate);

  const load = useCallback(async () => {
    if (!hydrated) return;
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const deptAware = ['projects', 'tasks', 'shift-notes', 'approvals', 'memos', 'requests', 'talk', 'docs', 'routines', 'guests', 'fixes', 'posts'].includes(config.resource);
      const rows = await api.list(
        config.resource,
        { active: true, q, status: activeStatus, department_id: deptAware ? currentDeptId : '' },
        { signal: request.signal },
      );
      if (request.isCurrent()) setItems(rows);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Could not load items.');
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [activeStatus, beginRequest, config.resource, currentDeptId, hydrated, q]);

  useEffect(() => { setFilter(config.filters[0] || 'All'); }, [config.resource, config.filters]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) setEditData(selected); }, [selected]);
  useEffect(() => { setWorkflowNote(''); setProofUrl(''); setProofFile(null); }, [selected?.id]);

  const sortedItems = useMemo(() => [...items].sort((a, b) => {
    const aTerminal = terminalStatuses.has(a.status) ? 1 : 0;
    const bTerminal = terminalStatuses.has(b.status) ? 1 : 0;
    if (aTerminal !== bTerminal) return aTerminal - bTerminal;
    const aPriority = priorityRank[a.priority || a.urgency] ?? 1;
    const bPriority = priorityRank[b.priority || b.urgency] ?? 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
  }), [items]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { All: items.length };
    config.filters.forEach(status => { if (status !== 'All') result[status] = items.filter(item => (item.status || item.review_status) === status).length; });
    return result;
  }, [items, config.filters]);
  const urgentCount = items.filter(item => item.priority === 'Urgent' || item.urgency === 'Urgent').length;
  const overdueCount = items.filter(item => dueState(item) === 'Overdue').length;
  const activeCount = items.filter(item => !terminalStatuses.has(item.status)).length;

  async function runAction(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError('');
    try { await action(); } catch (err: any) { setError(err.message || 'Action failed.'); } finally { setBusy(''); }
  }

  async function create() {
    if (!canManage) return;
    const required = config.fields.find(field => ['title', 'name', 'body'].includes(field.key));
    if (required && !String(data[required.key] || '').trim()) return setError(`${required.label} is required.`);
    await runAction('create', async () => {
      const deptAware = ['projects', 'tasks', 'shift-notes', 'approvals', 'memos', 'requests', 'talk', 'docs', 'routines', 'guests', 'fixes', 'posts'].includes(config.resource);
      await api.create(config.resource, deptAware && currentDeptId && !data.department_id ? { ...data, department_id: currentDeptId } : data);
      setData(defaultData(config.fields)); setShowAdd(false); await load();
    });
  }

  async function saveEdit() {
    if (!selected || !canManage) return;
    await runAction('edit', async () => { const updated = await api.update(config.resource, selected.id, { ...editData, expected_updated_at: selected.updated_at }); const fresh = await api.get(config.resource, selected.id); setSelected({ ...fresh, ...updated }); await load(); });
  }

  async function setStatus(status: string) {
    if (!selected || !canManage || selected.status === status || selected.review_status === status) return;
    await runAction(`status-${status}`, async () => { const updated = await api.status(config.resource, selected.id, status); const fresh = await api.get(config.resource, selected.id); setSelected({ ...fresh, ...updated }); await load(); });
  }

  async function generateRoutine() {
    if (!selected || !canManage || config.resource !== 'routines') return;
    await runAction('routine', async () => { await api.generateRoutine(selected.id); await load(); });
  }

  async function createLinkedTask() {
    if (!selected || !canManage) return;
    await runAction('linked-task', async () => {
      await api.workflowCreateTask(config.resource, selected.id, { department_id: selected.department_id || currentDeptId, note: workflowNote || `Created from ${config.resource} #${selected.id}.\n\n${selected.reason || selected.problem || selected.note || selected.caption || selected.body || ''}` });
      setSelected(await api.get(config.resource, selected.id)); setWorkflowNote(''); await load();
    });
  }

  async function sendRequestForApproval() {
    if (!selected || !canManage || config.resource !== 'requests' || ['Review', 'Approved', 'Rejected'].includes(selected.status)) return;
    await runAction('approval', async () => { await api.submitRequestApproval(selected.id, { department_id: selected.department_id || currentDeptId, note: workflowNote || selected.reason || selected.note || '' }); setSelected(await api.get('requests', selected.id)); setWorkflowNote(''); await load(); });
  }

  async function createFixFromGuest() {
    if (!selected || !canManage || config.resource !== 'guests') return;
    await runAction('fix', async () => { await api.guestCreateFix(selected.id, { department_id: selected.department_id || currentDeptId, note: workflowNote }); setSelected(await api.get('guests', selected.id)); setWorkflowNote(''); await load(); });
  }

  async function addComment() {
    if (!selected || !comment.trim()) return;
    await runAction('comment', async () => { await api.comment(config.resource, selected.id, comment.trim()); setSelected(await api.get(config.resource, selected.id)); setComment(''); });
  }

  async function verifyFix() {
    if (!selected || !canDecide || config.resource !== 'fixes') return;
    if (!workflowNote.trim()) return setError('Verification note is required.');
    await runAction('verify', async () => {
      let uploadedProofUrl = proofUrl.trim();
      if (proofFile) { const form = new FormData(); form.append('file', proofFile); const attachment = await api.attach('fixes', selected.id, form); uploadedProofUrl = attachment.file_url || uploadedProofUrl; }
      const updated = await api.verifyFix(selected.id, { note: workflowNote.trim(), proof_url: uploadedProofUrl || undefined, filename: proofFile?.name });
      const fresh = await api.get('fixes', selected.id); setSelected({ ...fresh, ...updated }); setWorkflowNote(''); setProofUrl(''); setProofFile(null); await load();
    });
  }

  const emptyMessage = q ? `No ${config.title.toLowerCase()} match “${q}”.` : filter !== 'All' ? `No items are currently ${filter.toLowerCase()}.` : `No active ${config.title.toLowerCase()} yet.`;
  const cardGrid = config.resource === 'tasks' ? 'grid cols-4' : 'grid cols-3';
  const showWorkflowNotes = canManage && ['requests', 'guests', 'shift-notes'].includes(config.resource) || canDecide && config.resource === 'fixes';

  return (
    <>
      <Top eyebrow={config.eyebrow} title={config.title} right={canManage ? <button data-testid={`create-${config.resource}`} className="btn" onClick={() => setShowAdd(s => !s)}>Add</button> : undefined} />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="panel"><div className="eyebrow">Active</div><h2>{activeCount}</h2></div>
        <div className="panel"><div className="eyebrow">Urgent</div><h2>{urgentCount}</h2></div>
        <div className="panel"><div className="eyebrow">Overdue</div><h2>{overdueCount}</h2></div>
      </div>
      {currentDeptId ? <div className="card-line" style={{ marginBottom: 12 }}><Pill value="Dept view" /><span className="muted">Showing the current department workspace where applicable.</span></div> : null}
      {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      <div className="toolbar">
        <input className="input" style={{ maxWidth: 320 }} placeholder={`Search ${config.title.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(); }} />
        <button className="btn secondary" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Search'}</button>
      </div>
      <div className="tabs" style={{ overflowX: 'auto' }}>{config.filters.map(f => <button key={f} onClick={() => setFilter(f)} className={`tab ${filter === f ? 'active' : ''}`}>{f} <span className="muted">{counts[f] ?? 0}</span></button>)}</div>
      {canManage && showAdd && <div className="panel" style={{ marginBottom: 16 }}><h2>Add {config.createLabel}</h2><div className="form" style={{ marginTop: 14 }}><div className="form-grid">{config.fields.map(field => <label className="label" key={field.key}>{field.label}<FieldInput field={field} value={data[field.key]} onChange={v => setData({ ...data, [field.key]: v })} /></label>)}</div><div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled={!!busy} onClick={create}>{busy === 'create' ? 'Saving…' : 'Save'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div></div></div>}
      <div className={cardGrid}>{loading ? <div className="empty">Loading operational work…</div> : sortedItems.length ? sortedItems.map(item => <ItemCard key={item.id} item={item} meta={config.cardMeta} onOpen={() => api.get(config.resource, item.id).then(setSelected).catch(err => setError(err.message || 'Could not open item.'))} />) : <div className="empty">{emptyMessage}</div>}</div>
      <Drawer item={selected} onClose={() => setSelected(null)}>
        {(canManage || canDecide) ? <div className="workflow-panel"><div><div className="eyebrow">Next step</div><h2>{config.resource === 'requests' ? 'Decision path' : config.resource === 'guests' ? 'Guest follow-up' : config.resource === 'fixes' ? 'Repair closure' : config.resource === 'shift-notes' ? 'Handover loop' : config.resource === 'routines' ? 'Recurring work' : config.resource === 'projects' ? 'Project execution' : 'Work item'}</h2></div><div className="workflow-actions">
          {canManage && config.resource === 'requests' ? <button className="btn small" disabled={!!busy || ['Review', 'Approved', 'Rejected'].includes(selected?.status)} onClick={sendRequestForApproval}>{busy === 'approval' ? 'Sending…' : 'Send to approval'}</button> : null}
          {canManage && config.resource === 'guests' ? <button className="btn small" disabled={!!busy} onClick={createFixFromGuest}>{busy === 'fix' ? 'Creating…' : 'Create fix'}</button> : null}
          {canManage && ['guests', 'fixes', 'shift-notes', 'requests', 'posts'].includes(config.resource) ? <button className="btn small secondary" disabled={!!busy} onClick={createLinkedTask}>{busy === 'linked-task' ? 'Creating…' : 'Create task'}</button> : null}
          {canManage && config.resource === 'routines' ? <button className="btn small" disabled={!!busy} onClick={generateRoutine}>{busy === 'routine' ? 'Generating…' : 'Generate task'}</button> : null}
        </div></div> : null}
        {showWorkflowNotes ? <div className="panel" style={{ marginBottom: 16 }}><h2>Process note</h2><div className="form" style={{ marginTop: 12 }}><textarea className="textarea" placeholder={config.resource === 'fixes' ? 'Verification note' : 'Workflow note'} value={workflowNote} onChange={e => setWorkflowNote(e.target.value)} />{canDecide && config.resource === 'fixes' ? <input className="input" type="file" onChange={e => setProofFile(e.target.files?.[0] || null)} /> : null}{canDecide && config.resource === 'fixes' ? <input className="input" placeholder="Proof URL optional" value={proofUrl} onChange={e => setProofUrl(e.target.value)} /> : null}{canDecide && config.resource === 'fixes' && selected?.status === 'Done' ? <button className="btn" disabled={!!busy} onClick={verifyFix}>{busy === 'verify' ? 'Verifying…' : 'Verify with note'}</button> : null}</div></div> : null}
        <StatusRail statuses={config.statuses} current={selected?.status || selected?.review_status} />
        {canManage ? <div className="panel"><h2>Edit</h2><div className="form" style={{ marginTop: 12 }}><div className="form-grid">{config.fields.map(field => <label className="label" key={field.key}>{field.label}<FieldInput field={field} value={editData[field.key]} onChange={v => setEditData({ ...editData, [field.key]: v })} /></label>)}</div><button className="btn secondary" disabled={!!busy} onClick={saveEdit}>{busy === 'edit' ? 'Saving…' : 'Save changes'}</button></div></div> : null}
        {canManage ? <div className="panel" style={{ marginTop: 16 }}><h2>Move workflow</h2><div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>{config.statuses.map(s => <button key={s} className="btn small secondary" disabled={!!busy || s === selected?.status || s === selected?.review_status} onClick={() => setStatus(s)}>{busy === `status-${s}` ? 'Updating…' : s}</button>)}</div></div> : null}
        <div className="panel" style={{ marginTop: 16 }}><h2>Comments</h2><div className="form" style={{ marginTop: 12 }}><textarea className="textarea" placeholder="Add context, decision, or handover note" value={comment} onChange={e => setComment(e.target.value)} /><button className="btn secondary" disabled={!!busy || !comment.trim()} onClick={addComment}>{busy === 'comment' ? 'Posting…' : 'Comment'}</button></div><div className="grid" style={{ marginTop: 12 }}>{(selected?.comments || []).map((c: Entity) => <div key={c.id} className="card"><b>{c.comment_type}</b><span>{c.body}</span></div>)}</div></div>
      </Drawer>
    </>
  );
}
