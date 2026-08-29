'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';

const sources = [
  ['external', 'Imported'],
  ['approvals', 'Approvals'],
  ['submissions', 'Inbox'],
  ['posts', 'Posts'],
  ['fixes', 'Verify'],
] as const;

const rank: Record<string, number> = { critical: 0, urgent: 0, high: 1, normal: 2, low: 3 };
const externalTerminal = new Set(['Approved', 'Rejected']);

function resourceFor(kind: string) {
  if (kind === 'Imported') return 'external-review-items';
  if (kind === 'Inbox') return 'submissions';
  if (kind === 'Verify') return 'fixes';
  return kind.toLowerCase();
}

function summary(item: Entity) {
  return String(item.summary || item.reason || item.problem || item.note || item.caption || '').trim();
}

function age(item: Entity) {
  const raw = item.created_at || item.submitted_at || item.updated_at;
  if (!raw) return '';
  const then = new Date(raw).getTime();
  if (!Number.isFinite(then)) return '';
  const hours = Math.max(0, Math.floor((Date.now() - then) / 3600000));
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<Entity>({});
  const [selected, setSelected] = useState<Entity | null>(null);
  const [kind, setKind] = useState('');
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const user = getStoredUser();
  const canManage = hasCapability(user, 'manage_department');
  const canDecide = hasCapability(user, 'make_decisions');
  const canManageApprovals = hasCapability(user, 'manage_approvals');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const departmentId = getCurrentDepartmentId(getStoredUser());
      setQueue(await api.reviewQueue({ department_id: departmentId || '' }));
    } catch (err: any) {
      setError(err.message || 'Could not load the review queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => {
    const rows: Entity[] = [];
    sources.forEach(([key, label]) => {
      (queue[key] || []).forEach((item: Entity) => rows.push({ ...item, review_kind: label }));
    });
    const term = query.trim().toLowerCase();
    return rows
      .filter(item => filter === 'All' || item.review_kind === filter)
      .filter(item => !term || [item.title, item.name, item.review_kind, item.status, item.review_status, summary(item)].filter(Boolean).join(' ').toLowerCase().includes(term))
      .sort((a, b) => {
        const priority = (rank[String(a.priority || a.urgency || 'normal').toLowerCase()] ?? 2) - (rank[String(b.priority || b.urgency || 'normal').toLowerCase()] ?? 2);
        if (priority) return priority;
        return new Date(a.created_at || a.submitted_at || a.updated_at || 0).getTime() - new Date(b.created_at || b.submitted_at || b.updated_at || 0).getTime();
      });
  }, [queue, filter, query]);

  async function open(item: Entity) {
    setKind(item.review_kind);
    setNote('');
    setError('');
    try {
      setSelected(await api.get(resourceFor(item.review_kind), item.id));
    } catch (err: any) {
      setError(err.message || 'Could not open the review item.');
    }
  }

  async function decide(action: string) {
    if (!selected || submitting) return;
    if (['Rejected', 'Verified', 'Fix'].includes(action) && !note.trim()) {
      setError('Add a decision note first.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (kind === 'Approvals') await api.decideApproval(selected.id, action, { note: note.trim() || undefined });
      else if (kind === 'Inbox') await api.decideSubmission(selected.id, action as 'Accepted' | 'Rejected', { note: note.trim() || undefined });
      else if (kind === 'Imported') {
        if (action === 'Seen') await api.externalMarkSeen(selected.id, { note: note.trim() || undefined });
        if (action === 'Task') await api.externalCreateTask(selected.id, { note: note.trim() || undefined });
        if (action === 'Approval') await api.externalCreateApproval(selected.id, { note: note.trim() || undefined });
        if (action === 'Rejected') await api.externalReject(selected.id, { note: note.trim() });
      } else if (kind === 'Verify') await api.verifyFix(selected.id, { note: note.trim() });
      else if (kind === 'Posts') await api.status('posts', selected.id, action, note.trim() || undefined);
      setSelected(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not complete the decision.');
    } finally {
      setSubmitting(false);
    }
  }

  const importedStatus = String(selected?.status || '');
  const importedTerminal = externalTerminal.has(importedStatus);
  const showImportedSeen = kind === 'Imported' && importedStatus === 'For Review';
  const showImportedTask = kind === 'Imported' && canManage && !importedTerminal && importedStatus !== 'Pending Approval';
  const showImportedApproval = kind === 'Imported' && canManageApprovals && !importedTerminal;
  const showImportedReject = kind === 'Imported' && canDecide && !importedTerminal && importedStatus !== 'Pending Approval';
  const showApprovalDecision = kind === 'Approvals' && canDecide && selected?.status === 'Pending';
  const showInboxDecision = kind === 'Inbox' && canDecide && selected?.review_status === 'New';
  const showVerify = kind === 'Verify' && canDecide && selected?.status === 'Done';
  const showPostDecision = kind === 'Posts' && canManage && !['OK', 'Posted', 'Archived'].includes(String(selected?.status || ''));
  const hasActions = showImportedSeen || showImportedTask || showImportedApproval || showImportedReject || showApprovalDecision || showInboxDecision || showVerify || showPostDecision;

  return <>
    <Top eyebrow="Decision queue" title="Review" right={<button className="btn secondary" onClick={() => void load()} disabled={loading || submitting}>{loading ? 'Refreshing…' : 'Refresh'}</button>} />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}

    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="card-line"><Pill value={`${items.length} visible`} /><span className="muted">Prioritized by urgency, then oldest first.</span></div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <input className="input" placeholder="Search decisions" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      <div className="tabs">
        {['All', ...sources.map(([, label]) => label)].map(label => <button key={label} className={`tab ${filter === label ? 'active' : ''}`} onClick={() => setFilter(label)}>{label}</button>)}
      </div>
    </section>

    <section className="panel">
      <div className="topbar"><div><div className="eyebrow">Highest consequence first</div><h2>Pending decisions</h2></div></div>
      {loading ? <div className="empty">Loading review queue…</div> : items.length ? <div className="grid">
        {items.map(item => <button type="button" className="card" key={`${item.review_kind}-${item.id}`} onClick={() => void open(item)} style={{ textAlign: 'left', width: '100%' }}>
          <div className="card-title">{item.title || item.name || 'Review item'}</div>
          <div className="card-line">
            <Pill value={item.review_kind} />
            <Pill value={item.status || item.review_status} />
            <Pill value={item.priority || item.urgency || 'Normal'} />
            {age(item) ? <Pill value={age(item)} /> : null}
          </div>
          {summary(item) ? <div className="muted">{summary(item).slice(0, 180)}</div> : null}
        </button>)}
      </div> : <div className="empty">No decisions match this view.</div>}
    </section>

    <Drawer item={selected} title={`${kind} decision`} onClose={() => { if (!submitting) setSelected(null); }}>
      <div className="panel">
        <h2>{hasActions ? 'Decision' : 'Review details'}</h2>
        <div className="form" style={{ marginTop: 12 }}>
          {hasActions ? <textarea className="textarea" placeholder="Decision reason or operational context" value={note} onChange={event => setNote(event.target.value)} disabled={submitting} /> : <p className="muted">No legal action is available for this item in your current session and state.</p>}
          {hasActions ? <div className="toolbar" style={{ marginBottom: 0 }}>
            {showApprovalDecision ? <><button className="btn small" onClick={() => void decide('Approved')} disabled={submitting}>Approve</button><button className="btn small secondary" onClick={() => void decide('Rejected')} disabled={submitting || !note.trim()}>Reject</button></> : null}
            {showImportedSeen ? <button className="btn small" onClick={() => void decide('Seen')} disabled={submitting}>Seen</button> : null}
            {showImportedTask ? <button className="btn small secondary" onClick={() => void decide('Task')} disabled={submitting}>Create task</button> : null}
            {showImportedApproval ? <button className="btn small secondary" onClick={() => void decide('Approval')} disabled={submitting}>Create approval</button> : null}
            {showImportedReject ? <button className="btn small secondary" onClick={() => void decide('Rejected')} disabled={submitting || !note.trim()}>Reject</button> : null}
            {showVerify ? <button className="btn small" onClick={() => void decide('Verified')} disabled={submitting || !note.trim()}>Verify</button> : null}
            {showInboxDecision ? <><button className="btn small" onClick={() => void decide('Accepted')} disabled={submitting}>Accept</button><button className="btn small secondary" onClick={() => void decide('Rejected')} disabled={submitting || !note.trim()}>Reject</button></> : null}
            {showPostDecision ? <><button className="btn small" onClick={() => void decide('OK')} disabled={submitting}>Approve creative</button><button className="btn small secondary" onClick={() => void decide('Fix')} disabled={submitting || !note.trim()}>Needs fix</button></> : null}
          </div> : null}
        </div>
      </div>
    </Drawer>
  </>;
}
