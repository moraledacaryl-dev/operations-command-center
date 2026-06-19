'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { ModuleConfig, Field } from '@/lib/config';
import { Top } from './Top';
import { Pill } from './Pill';
import { Drawer } from './Drawer';

function defaultData(fields: Field[]) {
  const data: Entity = {};
  fields.forEach(f => {
    if (f.key === 'status' && f.options?.[0]) data[f.key] = f.options[0];
    else if (f.key === 'priority' || f.key === 'urgency') data[f.key] = 'Normal';
    else if (f.source) data[f.key] = null;
    else data[f.key] = '';
  });
  return data;
}

function optionLabel(field: Field, item: Entity) {
  if (field.source === 'users') return `${item.name}${item.role ? ` - ${item.role}` : ''}`;
  if (field.source === 'rooms') return `${item.name}${item.kind ? ` - ${item.kind}` : ''}`;
  return item.name || item.title || String(item.id);
}

function sourceRows(field: Field, meta: Entity) {
  if (!field.source) return [];
  return meta[field.source] || [];
}

function FieldInput({ field, value, meta, onChange }: { field: Field; value: any; meta: Entity; onChange: (v: any) => void }) {
  if (field.source) {
    return (
      <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">None</option>
        {sourceRows(field, meta).map((item: Entity) => <option key={item.id} value={item.id}>{optionLabel(field, item)}</option>)}
      </select>
    );
  }
  if (field.type === 'select') {
    return <select className="select" value={value || ''} onChange={(e) => onChange(e.target.value)}>{field.options?.map(o => <option key={o}>{o}</option>)}</select>;
  }
  if (field.type === 'textarea') {
    return <textarea className="textarea" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === 'date') {
    return <input className="input" type="date" value={value ? String(value).slice(0, 10) : ''} onChange={(e) => onChange(e.target.value || null)} />;
  }
  return <input className="input" type={field.type || 'text'} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
}

function findById(rows: Entity[] = [], id: any) {
  return rows.find(row => Number(row.id) === Number(id));
}

function formatDate(value?: string) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function fieldDisplay(key: string, item: Entity, meta: Entity) {
  const value = item[key];
  if (value === undefined || value === null || value === '') return '';
  if (key === 'assigned_to_id') return `Assigned: ${findById(meta.users, value)?.name || value}`;
  if (key === 'owner_id') return `Owner: ${findById(meta.users, value)?.name || value}`;
  if (key === 'department_id') return findById(meta.departments, value)?.name || value;
  if (key === 'room_area_id') return findById(meta.rooms, value)?.name || value;
  if (key.endsWith('_date') || key.endsWith('_at')) return formatDate(value);
  return String(value);
}

function ItemCard({ item, metaKeys, meta, onOpen }: { item: Entity; metaKeys: string[]; meta: Entity; onOpen: () => void }) {
  const important = ['Urgent', 'Late', 'Review', 'Pending', 'Done'].includes(item.priority || item.urgency || item.status || item.review_status || '');
  return (
    <div className={`card ${important ? 'card-important' : ''}`} onClick={onOpen}>
      <div className="card-title">{item.title || item.name || 'Untitled'}</div>
      <div className="card-line">
        {metaKeys.map((m) => {
          const display = fieldDisplay(m, item, meta);
          return display ? <Pill key={m} value={display.slice(0, 32)} /> : null;
        })}
      </div>
      {item.note || item.problem || item.caption ? <div className="muted" style={{ fontSize: 13 }}>{String(item.note || item.problem || item.caption).slice(0, 92)}</div> : null}
    </div>
  );
}

function StatusRail({ statuses, current }: { statuses: string[]; current?: string }) {
  return (
    <div className="status-rail">
      {statuses.map(status => <span key={status} className={status === current ? 'current' : ''}>{status}</span>)}
    </div>
  );
}

function OwnerContext({ item, meta }: { item: Entity; meta: Entity }) {
  const rows = [
    ['Department', findById(meta.departments, item?.department_id)?.name],
    ['Room / area', findById(meta.rooms, item?.room_area_id)?.name],
    ['Assigned', findById(meta.users, item?.assigned_to_id)?.name],
    ['Owner', findById(meta.users, item?.owner_id)?.name],
    ['Due', formatDate(item?.due_date || item?.follow_up_date)],
    ['Updated', formatDate(item?.updated_at)],
  ].filter(([, value]) => value);
  if (!rows.length) return null;
  return (
    <div className="panel context-panel">
      <h2>Owner view</h2>
      <div className="context-grid">
        {rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
      </div>
    </div>
  );
}

export function ModulePage({ config }: { config: ModuleConfig }) {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [meta, setMeta] = useState<Entity>({ users: [], departments: [], rooms: [] });
  const [showAdd, setShowAdd] = useState(false);
  const [data, setData] = useState<Entity>(() => defaultData(config.fields));
  const [editData, setEditData] = useState<Entity>({});
  const [filter, setFilter] = useState(config.filters[0] || 'All');
  const [q, setQ] = useState('');
  const [comment, setComment] = useState('');
  const [workflowNote, setWorkflowNote] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [currentDeptId, setCurrentDeptId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const activeStatus = filter !== 'All' ? filter : '';

  async function load() {
    setLoading(true);
    setError('');
    try {
      const deptAware = ['projects', 'tasks', 'shift-notes', 'approvals', 'memos', 'requests', 'talk', 'docs', 'routines', 'guests', 'fixes', 'posts'].includes(config.resource);
      const rows = await api.list(config.resource, { active: true, q, status: activeStatus, department_id: deptAware ? currentDeptId : '' });
      setItems(rows);
    } catch (err: any) {
      setError(err.message || 'Could not load items.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { const user = getStoredUser(); setCurrentDeptId(getCurrentDepartmentId(user)); }, []);
  useEffect(() => { api.meta().then(setMeta).catch(() => null); }, []);
  useEffect(() => { setFilter(config.filters[0] || 'All'); }, [config.resource]);
  useEffect(() => { load(); }, [config.resource, filter, currentDeptId]);
  useEffect(() => { if (selected) setEditData(selected); }, [selected?.id]);
  useEffect(() => { setWorkflowNote(''); setProofUrl(''); setProofFile(null); }, [selected?.id]);

  async function create() {
    const required = config.fields.find(field => ['title', 'name', 'body'].includes(field.key));
    if (required && !String(data[required.key] || '').trim()) {
      setError(`${required.label} is required.`);
      return;
    }
    const deptAware = ['projects', 'tasks', 'shift-notes', 'approvals', 'memos', 'requests', 'talk', 'docs', 'routines', 'guests', 'fixes', 'posts'].includes(config.resource);
    try {
      await api.create(config.resource, deptAware && currentDeptId && !data.department_id ? { ...data, department_id: currentDeptId } : data);
      setData(defaultData(config.fields));
      setShowAdd(false);
      load();
    } catch (err: any) {
      setError(err.message || 'Could not save item.');
    }
  }

  async function saveEdit() {
    if (!selected) return;
    try {
      const updated = await api.update(config.resource, selected.id, editData);
      const fresh = await api.get(config.resource, selected.id);
      setSelected({ ...fresh, ...updated });
      load();
    } catch (err: any) {
      setError(err.message || 'Could not update item.');
    }
  }

  async function setStatus(status: string) {
    if (!selected) return;
    try {
      const updated = await api.status(config.resource, selected.id, status);
      const fresh = await api.get(config.resource, selected.id);
      setSelected({ ...fresh, ...updated });
      load();
    } catch (err: any) {
      setError(err.message || 'Could not update status.');
    }
  }

  async function generateRoutine() {
    if (!selected || config.resource !== 'routines') return;
    await api.generateRoutine(selected.id);
    load();
  }

  async function createLinkedTask() {
    if (!selected) return;
    try {
      await api.workflowCreateTask(config.resource, selected.id, {
        department_id: selected.department_id || currentDeptId,
        note: workflowNote || `Created from ${config.resource} #${selected.id}.\n\n${selected.reason || selected.problem || selected.note || selected.caption || selected.body || ''}`,
      });
      const fresh = await api.get(config.resource, selected.id);
      setSelected(fresh);
      setWorkflowNote('');
      load();
    } catch (err: any) {
      setError(err.message || 'Could not create linked task.');
    }
  }

  async function sendRequestForApproval() {
    if (!selected || config.resource !== 'requests') return;
    try {
      await api.submitRequestApproval(selected.id, { department_id: selected.department_id || currentDeptId, note: workflowNote || selected.reason || selected.note || '' });
      const fresh = await api.get('requests', selected.id);
      setSelected(fresh);
      setWorkflowNote('');
      load();
    } catch (err: any) {
      setError(err.message || 'Could not send request for approval.');
    }
  }

  async function createFixFromGuest() {
    if (!selected || config.resource !== 'guests') return;
    try {
      await api.guestCreateFix(selected.id, { department_id: selected.department_id || currentDeptId, note: workflowNote });
      const fresh = await api.get('guests', selected.id);
      setSelected(fresh);
      setWorkflowNote('');
      load();
    } catch (err: any) {
      setError(err.message || 'Could not create fix.');
    }
  }

  async function addComment() {
    if (!selected || !comment.trim()) return;
    await api.comment(config.resource, selected.id, comment.trim());
    const fresh = await api.get(config.resource, selected.id);
    setSelected(fresh);
    setComment('');
  }

  async function verifyFix() {
    if (!selected || config.resource !== 'fixes') return;
    if (!workflowNote.trim()) {
      setError('Verification note is required.');
      return;
    }
    try {
      let uploadedProofUrl = proofUrl.trim();
      if (proofFile) {
        const form = new FormData();
        form.append('file', proofFile);
        const attachment = await api.attach('fixes', selected.id, form);
        uploadedProofUrl = attachment.file_url || uploadedProofUrl;
      }
      const updated = await api.verifyFix(selected.id, { note: workflowNote.trim(), proof_url: uploadedProofUrl || undefined, filename: proofFile?.name });
      const fresh = await api.get('fixes', selected.id);
      setSelected({ ...fresh, ...updated });
      setWorkflowNote('');
      setProofUrl('');
      setProofFile(null);
      load();
    } catch (err: any) {
      setError(err.message || 'Could not verify fix.');
    }
  }

  async function archiveItem() {
    if (!selected) return;
    if (!window.confirm('Archive this completed item? It will move to History.')) return;
    try {
      await api.archive(config.resource, selected.id);
      setSelected(null);
      load();
    } catch (err: any) {
      setError(err.message || 'Could not archive item.');
    }
  }

  return (
    <>
      <Top eyebrow={config.eyebrow} title={config.title} right={<button className="btn" onClick={() => setShowAdd(s => !s)}>Add</button>} />
      {currentDeptId ? <div className="card-line" style={{ marginBottom: 12 }}><Pill value="Dept view" /><span className="muted">Showing current workspace where applicable.</span></div> : null}
      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
      <div className="toolbar">
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} />
        <button className="btn secondary" onClick={load}>Go</button>
      </div>
      <div className="tabs">
        {config.filters.map(f => <button key={f} onClick={() => setFilter(f)} className={`tab ${filter === f ? 'active' : ''}`}>{f}</button>)}
      </div>
      {showAdd && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Add {config.createLabel}</h2>
          <div className="form" style={{ marginTop: 14 }}>
            <div className="form-grid">
              {config.fields.map(field => (
                <label className="label" key={field.key}>{field.label}<FieldInput field={field} meta={meta} value={data[field.key]} onChange={(v) => setData({ ...data, [field.key]: v })} /></label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={create}>Save</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      <div className="grid cols-3">
        {loading ? <div className="empty">Loading</div> : items.length ? items.map(item => <ItemCard key={item.id} item={item} metaKeys={config.cardMeta} meta={meta} onOpen={() => api.get(config.resource, item.id).then(setSelected).catch((err) => setError(err.message || 'Could not open item.'))} />) : <div className="empty">All clear</div>}
      </div>
      <Drawer item={selected} onClose={() => setSelected(null)}>
        <OwnerContext item={selected || {}} meta={meta} />
        <div className="workflow-panel">
          <div>
            <div className="eyebrow">Next step</div>
            <h2>{config.resource === 'requests' ? 'Decision path' : config.resource === 'guests' ? 'Guest follow-up' : config.resource === 'fixes' ? 'Repair closure' : config.resource === 'shift-notes' ? 'Handover loop' : config.resource === 'routines' ? 'Recurring work' : 'Work item'}</h2>
          </div>
          <div className="workflow-actions">
            {config.resource === 'requests' ? <button className="btn small" onClick={sendRequestForApproval}>Send to approval</button> : null}
            {config.resource === 'guests' ? <button className="btn small" onClick={createFixFromGuest}>Create fix</button> : null}
            {['guests', 'fixes', 'shift-notes', 'requests', 'posts'].includes(config.resource) ? <button className="btn small secondary" onClick={createLinkedTask}>Create task</button> : null}
            {config.resource === 'routines' ? <button className="btn small" onClick={generateRoutine}>Generate task</button> : null}
          </div>
        </div>
        {['requests', 'guests', 'fixes'].includes(config.resource) ? (
          <div className="panel" style={{ marginBottom: 16 }}>
            <h2>Process note</h2>
            <div className="form" style={{ marginTop: 12 }}>
              <textarea className="textarea" placeholder={config.resource === 'fixes' ? 'Verification note' : 'Workflow note'} value={workflowNote} onChange={(e) => setWorkflowNote(e.target.value)} />
              {config.resource === 'fixes' ? <input className="input" type="file" onChange={(e) => setProofFile(e.target.files?.[0] || null)} /> : null}
              {config.resource === 'fixes' ? <input className="input" placeholder="Proof URL optional" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} /> : null}
              {config.resource === 'fixes' ? <button className="btn" onClick={verifyFix}>Verify with note</button> : null}
            </div>
          </div>
        ) : null}
        <StatusRail statuses={config.statuses} current={selected?.status || selected?.review_status} />
        <div className="panel">
          <h2>Edit</h2>
          <div className="form" style={{ marginTop: 12 }}>
            <div className="form-grid">
              {config.fields.map(field => (
                <label className="label" key={field.key}>{field.label}<FieldInput field={field} meta={meta} value={editData[field.key]} onChange={(v) => setEditData({ ...editData, [field.key]: v })} /></label>
              ))}
            </div>
            <button className="btn secondary" onClick={saveEdit}>Save changes</button>
          </div>
        </div>
        <div className="panel" style={{ marginTop: 16 }}>
          <h2>Actions</h2>
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            {config.statuses.map(s => <button key={s} className="btn small secondary" onClick={() => setStatus(s)}>{s}</button>)}
            <button className="btn small secondary" onClick={archiveItem}>Archive</button>
          </div>
        </div>
        <div className="panel" style={{ marginTop: 16 }}>
          <h2>Comments</h2>
          <div className="form" style={{ marginTop: 12 }}>
            <textarea className="textarea" placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="btn secondary" onClick={addComment}>Comment</button>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            {(selected?.comments || []).map((c: Entity) => <div key={c.id} className="card"><b>{c.comment_type}</b><span>{c.body}</span></div>)}
          </div>
        </div>
      </Drawer>
    </>
  );
}
