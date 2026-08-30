'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';
import { Tabs } from '@/components/Tabs';
import { MarketingWorkspace } from '@/components/MarketingWorkspace';
import { useActiveDepartment, useCreateIntent, useLatestRequest } from '@/lib/operation-hooks';
import { hasCapability } from '@/lib/capabilities';
import { getStoredUser } from '@/lib/session';

const statuses = ['Idea', 'Draft', 'Review', 'Fix', 'OK', 'Set', 'Posted'];
const platforms = ['Facebook', 'Instagram', 'TikTok', 'Google Business', 'Website'];
const types = ['Reel', 'Story', 'Static', 'Carousel', 'Ad', 'Blog'];
const blank: Entity = { title: '', platform: 'Facebook', content_type: 'Reel', post_date: '', status: 'Idea', caption: '', campaign: '' };

function assetHref(url?: string) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads')) return `${API_BASE.replace('/api', '')}${url}`;
  return url;
}

function formatDate(value?: string) {
  if (!value) return 'Unscheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unscheduled';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function monthKey(value?: string) {
  if (!value) return 'Unscheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unscheduled';
  return new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(date);
}

const actionLabels: Record<string, string> = {
  'start-draft': 'Start draft',
  'submit-review': 'Submit for review',
  'resubmit-review': 'Resubmit for review',
  'request-revision': 'Needs revision',
  approve: 'Approve creative',
  schedule: 'Schedule',
  publish: 'Mark posted',
  'return-draft-from-fix': 'Return to draft',
  'return-draft-from-ok': 'Return to draft',
  'return-draft-from-set': 'Return to draft',
  reopen: 'Reopen as draft',
};

export default function MarketingPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [versions, setVersions] = useState<Entity[]>([]);
  const [filter, setFilter] = useState('Active');
  const [platformFilter, setPlatformFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [data, setData] = useState<Entity>(blank);
  const [comment, setComment] = useState('');
  const [transitionNote, setTransitionNote] = useState('');
  const [version, setVersion] = useState({ filename: '', file_url: '', note: '', caption_snapshot: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const { hydrated } = useActiveDepartment();
  const [user] = useState(() => getStoredUser());
  const canManage = hasCapability(user, 'manage_department');
  const canViewAll = hasCapability(user, 'view_all_operations');
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const beginRequest = useLatestRequest();
  const openCreate = useCallback(() => { if (canManage && departmentId) setShowAdd(true); }, [canManage, departmentId]);
  useCreateIntent(openCreate);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const membership = (user?.departments || []).find((department: Entity) => String(department.name || '').toLowerCase().includes('marketing'));
    if (membership?.id) {
      setDepartmentId(Number(membership.id));
      setScopeReady(true);
      return;
    }
    if (!canViewAll) {
      setDepartmentId(null);
      setScopeReady(true);
      return;
    }
    api.meta().then(meta => {
      if (cancelled) return;
      const marketing = (meta.departments || []).find((department: Entity) => String(department.name || '').toLowerCase().includes('marketing'));
      setDepartmentId(marketing?.id ? Number(marketing.id) : null);
      setScopeReady(true);
    }).catch(err => {
      if (!cancelled) {
        setError(err.message || 'Marketing workspace could not be resolved.');
        setScopeReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [canViewAll, hydrated, user?.departments]);

  const load = useCallback(async (cursor?: string | null) => {
    if (!hydrated || !scopeReady) return;
    if (!departmentId) {
      setItems([]);
      setError('No accessible Marketing workspace is assigned to this account.');
      return;
    }
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const page = await api.page('posts', { active: true, department_id: departmentId, limit: 30, cursor: cursor || '' }, { signal: request.signal });
      if (request.isCurrent()) {
        setItems(existing => cursor ? [...existing, ...page.items] : page.items);
        setNextCursor(page.next_cursor || null);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (request.isCurrent()) setError(err.message || 'Marketing work could not be loaded.');
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [beginRequest, departmentId, hydrated, scopeReady]);

  useEffect(() => { void load(); }, [load]);

  async function open(item: Entity) {
    try {
      const fresh = await api.get('posts', item.id);
      setSelected(fresh);
      setTransitionNote('');
      setVersions(await api.versions(item.id));
    } catch (err: any) {
      setError(err.message || 'Marketing item could not be opened.');
    }
  }

  async function create() {
    if (!canManage || !departmentId || !String(data.title || '').trim() || busy) {
      if (!String(data.title || '').trim()) setError('Title is required.');
      return;
    }
    setBusy(true);
    try {
      await api.create('posts', departmentId && !data.department_id ? { ...data, department_id: departmentId } : data);
      setData(blank);
      setShowAdd(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Marketing item could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: string) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api.workflowAction('posts', selected.id, action, { note: transitionNote.trim() || null });
      setTransitionNote('');
      await open(selected);
      await load();
    } catch (err: any) {
      setError(err.message || 'Marketing status could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function addComment() {
    if (!selected || !comment.trim() || busy) return;
    setBusy(true);
    try {
      await api.comment('posts', selected.id, comment.trim(), 'Creative review');
      setComment('');
      await open(selected);
    } catch (err: any) {
      setError(err.message || 'Comment could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function addVersion() {
    if (!selected || busy) return;
    if (!file && !version.file_url.trim()) {
      setError('Choose a file or provide an asset URL.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      Object.entries(version).forEach(([key, value]) => form.append(key, value));
      if (file) form.append('file', file);
      await api.addVersion(selected.id, form);
      setVersion({ filename: '', file_url: '', note: '', caption_snapshot: '' });
      setFile(null);
      await open(selected);
      await load();
    } catch (err: any) {
      setError(err.message || 'Asset version could not be added.');
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => items.filter(item => {
    const statusMatch = filter === 'All' || (filter === 'Active' ? item.status !== 'Posted' : item.status === filter);
    const platformMatch = platformFilter === 'All' || item.platform === platformFilter;
    return statusMatch && platformMatch;
  }).sort((a, b) => {
    const aDate = new Date(String(a.post_date || '2999-12-31')).getTime();
    const bDate = new Date(String(b.post_date || '2999-12-31')).getTime();
    return aDate - bDate;
  }), [items, filter, platformFilter]);

  const groups = useMemo(() => visible.reduce<Record<string, Entity[]>>((result, item) => {
    const key = monthKey(item.post_date);
    result[key] = [...(result[key] || []), item];
    return result;
  }, {}), [visible]);

  const awaitingReview = items.filter(item => item.status === 'Review').length;
  const needsFix = items.filter(item => item.status === 'Fix').length;
  const scheduled = items.filter(item => item.status === 'Set').length;
  const allowedActions: string[] = selected?.allowed_actions || [];

  return <>
    <Top eyebrow="Publishing calendar" title="Marketing" right={canManage && departmentId ? <button className="btn" onClick={() => setShowAdd(value => !value)}>New content</button> : undefined} />
    {departmentId ? <MarketingWorkspace departmentId={departmentId} canManage={canManage} /> : null}
    <div className="legacy-section-head"><div><p className="eyebrow">Compatibility workspace</p><h2>Legacy content records</h2></div><p className="muted">Existing posts remain available while campaigns and platform deliverables become the primary planning model.</p></div>
    <div className="grid cols-3" style={{ marginBottom: 16 }}>
      <div className="panel"><div className="eyebrow">Awaiting review</div><h2>{awaitingReview}</h2></div>
      <div className="panel"><div className="eyebrow">Needs revision</div><h2>{needsFix}</h2></div>
      <div className="panel"><div className="eyebrow">Scheduled</div><h2>{scheduled}</h2></div>
    </div>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {canManage && showAdd ? <section className="panel" style={{ marginBottom: 16 }}>
      <h2>Create content item</h2>
      <div className="form" style={{ marginTop: 14 }}>
        <div className="form-grid">
          <label className="label">Title<input className="input" value={data.title} onChange={event => setData({ ...data, title: event.target.value })} /></label>
          <label className="label">Platform<select className="select" value={data.platform} onChange={event => setData({ ...data, platform: event.target.value })}>{platforms.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="label">Format<select className="select" value={data.content_type} onChange={event => setData({ ...data, content_type: event.target.value })}>{types.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="label">Publish date<input type="date" className="input" value={data.post_date} onChange={event => setData({ ...data, post_date: event.target.value })} /></label>
          <label className="label">Campaign<input className="input" value={data.campaign} onChange={event => setData({ ...data, campaign: event.target.value })} /></label>
        </div>
        <label className="label">Caption or brief<textarea className="textarea" value={data.caption} onChange={event => setData({ ...data, caption: event.target.value })} /></label>
        <div className="toolbar"><button className="btn" disabled={busy || !String(data.title || '').trim()} onClick={create}>{busy ? 'Saving…' : 'Create item'}</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
      </div>
    </section> : null}
    <div className="toolbar" style={{ alignItems: 'center' }}>
      <Tabs values={['Active', 'All', ...statuses]} active={filter} onChange={setFilter} label="Marketing status" />
      <select className="select" aria-label="Filter by platform" value={platformFilter} onChange={event => setPlatformFilter(event.target.value)}><option>All</option>{platforms.map(value => <option key={value}>{value}</option>)}</select>
    </div>
    <div className="grid">
      {Object.entries(groups).map(([month, monthItems]) => <section className="panel" key={month}>
        <div className="card-line" style={{ justifyContent: 'space-between' }}><h2>{month}</h2><Pill value={String(monthItems.length)} /></div>
        <div className="grid cols-3" style={{ marginTop: 12 }}>
          {monthItems.map(item => <button type="button" className={`card ${item.status === 'Fix' || item.status === 'Review' ? 'card-important' : ''}`} key={item.id} onClick={() => open(item)} style={{ textAlign: 'left' }}>
            <strong>{item.title}</strong>
            <span className="card-line"><Pill value={item.platform || 'Platform'} /><Pill value={item.status || 'Idea'} /><Pill value={item.content_type || 'Content'} /></span>
            <span className="muted">{formatDate(item.post_date)}{item.campaign ? ` · ${item.campaign}` : ''}</span>
            {item.caption ? <span className="muted">{String(item.caption).slice(0, 110)}</span> : null}
          </button>)}
        </div>
      </section>)}
      {!visible.length ? <div className="empty">No marketing items match this view.</div> : null}
    </div>
    {nextCursor ? <div className="load-more"><button className="btn secondary" disabled={loading} onClick={() => void load(nextCursor)}>{loading ? 'Loading…' : 'Load more content'}</button><span className="muted" aria-live="polite">{items.length} items loaded</span></div> : null}
    <Drawer item={selected} title="Marketing item" onClose={() => { if (!busy) setSelected(null); }}>
      {selected ? <>
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Publishing readiness</div>
          <h2>{selected.status === 'Posted' ? 'Published' : allowedActions.length ? 'Ready for action' : 'No next action'}</h2>
          <div className="card-line"><Pill value={selected.status || 'Idea'} /><Pill value={selected.platform || 'Platform'} /><Pill value={formatDate(selected.post_date)} /></div>
          <p className="muted">{selected.caption || 'No caption or creative brief yet.'}</p>
          {allowedActions.length ? <label className="label">Action note<textarea className="textarea" value={transitionNote} onChange={event => setTransitionNote(event.target.value)} placeholder="Required for revisions, returns, and reopen actions" /></label> : null}
          <div className="toolbar">
            {allowedActions.map(action => {
              const needsNote = action === 'request-revision' || action.startsWith('return-draft') || action === 'reopen';
              return <button className={['approve', 'publish', 'start-draft', 'submit-review', 'resubmit-review', 'schedule'].includes(action) ? 'btn' : 'btn secondary'} key={action} disabled={busy || (needsNote && !transitionNote.trim())} onClick={() => transition(action)}>{busy ? 'Saving…' : actionLabels[action] || action}</button>;
            })}
          </div>
        </section>
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Creative versions</h2>
          <div className="form" style={{ marginTop: 12 }}>
            <div className="form-grid"><label className="label">File<input className="input" type="file" onChange={event => setFile(event.target.files?.[0] || null)} /></label><label className="label">Asset URL<input className="input" value={version.file_url} onChange={event => setVersion({ ...version, file_url: event.target.value })} /></label></div>
            <label className="label">Display name<input className="input" value={version.filename} onChange={event => setVersion({ ...version, filename: event.target.value })} /></label>
            <label className="label">Caption snapshot<textarea className="textarea" value={version.caption_snapshot} onChange={event => setVersion({ ...version, caption_snapshot: event.target.value })} /></label>
            <label className="label">Version note<textarea className="textarea" value={version.note} onChange={event => setVersion({ ...version, note: event.target.value })} /></label>
            <button className="btn secondary" disabled={busy} onClick={addVersion}>Add version</button>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>{versions.map(item => <div className="card" key={item.id}><strong>V{item.version_no}{item.is_current ? ' · Current' : ''}</strong><span>{item.filename || 'Creative asset'}</span>{item.file_url ? <a className="btn small secondary" href={assetHref(item.file_url)} target="_blank" rel="noreferrer">Open asset</a> : null}<span className="muted">{item.note}</span></div>)}{!versions.length ? <div className="empty">No creative versions uploaded.</div> : null}</div>
        </section>
        <section className="panel">
          <h2>Review conversation</h2>
          <div className="form" style={{ marginTop: 12 }}><textarea className="textarea" placeholder="Add review feedback" value={comment} onChange={event => setComment(event.target.value)} /><button className="btn secondary" disabled={busy || !comment.trim()} onClick={addComment}>Add feedback</button></div>
          <div className="grid" style={{ marginTop: 12 }}>{(selected.comments || []).map((item: Entity) => <div className="card" key={item.id}><strong>{item.comment_type || 'Comment'}</strong><span>{item.body}</span></div>)}{!(selected.comments || []).length ? <div className="empty">No review feedback yet.</div> : null}</div>
        </section>
      </> : null}
    </Drawer>
  </>;
}
