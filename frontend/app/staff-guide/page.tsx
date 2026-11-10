'use client';

import { useCallback, useEffect, useState } from 'react';
import { Top } from '@/components/Top';
import { api, Entity } from '@/lib/api';
import { getStoredUser } from '@/lib/session';
import styles from './staff-guide.module.css';

type Tab = 'guides' | 'reading' | 'manage';
type Draft = {
  title: string; doc_type: string; category: string; summary: string; body: string;
  audience: string; department_ids: number[]; requires_ack: boolean;
};
const blank: Draft = {
  title: '', doc_type: 'Quick Guide', category: 'General', summary: '',
  body: '', audience: 'departments', department_ids: [], requires_ack: false,
};
function dateLabel(raw: string | null | undefined) {
  if (!raw) return '';
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? '' : value.toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

export default function StaffGuidePage() {
  const [tab, setTab] = useState<Tab>('guides');
  const [guides, setGuides] = useState<Entity[]>([]);
  const [reading, setReading] = useState<Entity[]>([]);
  const [managed, setManaged] = useState<Entity[]>([]);
  const [departments, setDepartments] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft>({ ...blank });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [role, setRole] = useState('');
  const canManage = ['owner', 'admin', 'manager', 'lead', 'supervisor'].includes(role);
  const canPublish = ['owner', 'admin'].includes(role);

  const refresh = useCallback(async (q = '') => {
    const [all, mine, manage] = await Promise.all([
      api.staffGuideList(q), api.staffGuideMine(),
      canManage ? api.staffGuideManage() : Promise.resolve([]),
    ]);
    setGuides(all);
    setReading(mine);
    setManaged(manage);
  }, [canManage]);

  const openGuide = useCallback(async (id: number) => {
    setError('');
    try {
      const result = await api.staffGuideGet(id);
      setSelected(result);
      setEditingId(null);
      setEditorOpen(false);
    } catch (err) {
      setError((err as Error).message || 'Could not open the guide.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const user = getStoredUser();
    setRole(String(user?.role || '').toLowerCase());
    const initialDepartments = Array.isArray(user?.departments) ? user.departments : [];
    setDepartments(initialDepartments);
    if (['owner', 'admin', 'manager'].includes(String(user?.role || '').toLowerCase())) {
      api.list('departments').then(rows => {
        if (!cancelled) setDepartments(rows);
      }).catch(() => undefined);
    }
    refresh().then(() => {
      if (cancelled) return;
      const id = Number(new URLSearchParams(window.location.search).get('doc'));
      if (Number.isSafeInteger(id) && id > 0) void openGuide(id);
    }).catch((err: Error) => {
      if (!cancelled) setError(err.message || 'Staff Guide could not be loaded.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh, openGuide]);

  async function run(action: () => Promise<unknown>, success: string, reopenId?: number) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh(search);
      if (reopenId) await openGuide(reopenId);
      setNotice(success);
    } catch (err) {
      setError((err as Error).message || 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  function editSelected() {
    if (!selected?.draft) return;
    setDraft({
      ...blank, ...selected.draft,
      department_ids: Array.isArray(selected.draft.department_ids)
        ? selected.draft.department_ids.map(Number) : [],
    });
    setEditingId(Number(selected.id));
    setEditorOpen(true);
    setSelected(null);
    setTab('manage');
  }

  function startNew() {
    setDraft({ ...blank, department_ids: [] });
    setEditingId(null);
    setEditorOpen(true);
    setSelected(null);
    setNotice('');
    setTab('manage');
  }

  async function saveDraft() {
    const values = { ...draft, title: draft.title.trim(), body: draft.body.trim() };
    if (!values.title || !values.body) {
      setError('Please add a title and clear instructions.');
      return;
    }
    if (values.audience === 'departments' && !values.department_ids.length) {
      setError('Select at least one department.');
      return;
    }
    const id = editingId;
    await run(async () => {
      const result = id ? await api.staffGuideEdit(id, values) : await api.staffGuideCreate(values);
      setEditorOpen(false);
      await openGuide(Number(result.id));
    }, 'Draft saved.');
  }

  const pendingCount = reading.filter(item => !item.acknowledged).length;
  const current = selected?.published;
  const currentDraft = selected?.draft;
  return <div className={styles.wrap}>
    <Top title="Staff Guide" right={canManage ?
      <button type="button" className="btn" onClick={startNew}>+ New guide</button> : undefined} />
    <p className={styles.intro}>Find the correct steps for your work. Only approved guides are shown to staff.</p>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <div className={styles.tabs} role="tablist" aria-label="Staff Guide sections">
      <button type="button" className={tab === 'guides' ? styles.active : ''} onClick={() => { setTab('guides'); setSelected(null); }}>Guides &amp; What&apos;s New</button>
      <button type="button" className={tab === 'reading' ? styles.active : ''} onClick={() => { setTab('reading'); setSelected(null); }}>My Reading{pendingCount ? ' (' + pendingCount + ')' : ''}</button>
      {canManage ? <button type="button" className={tab === 'manage' ? styles.active : ''} onClick={() => { setTab('manage'); setSelected(null); }}>Manage Guides</button> : null}
    </div>

    {selected && !editorOpen ? <section className={styles.detail}>
      <button type="button" className="btn secondary" onClick={() => setSelected(null)}>Back to list</button>
      {current ? <>
        <p className={styles.meta}>{current.doc_type} · {current.category} · Version {current.version} · Published {dateLabel(current.published_at)}</p>
        <h2>{current.title}</h2>
        {current.summary ? <p className={styles.summary}>{current.summary}</p> : null}
        <div className={styles.body}>{current.body}</div>
        {current.requires_ack ? <div className={styles.ack}>
          {current.acknowledged ? <strong>You&apos;ve confirmed this version.</strong> :
            <><p>After reading, confirm that you understand this guide.</p>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(
              () => api.staffGuideAcknowledge(Number(selected.id)),
              'Reading confirmed.', Number(selected.id),
            )}>I have read and understood</button></>}
        </div> : null}
      </> : <p>No published version yet. Only authorized editors can see this draft.</p>}
      {currentDraft ? <section className={styles.preview}>
        <h3>Working copy · {selected.status}</h3>
        <p className={styles.meta}>This text is not shown to regular staff until published.</p>
        <strong>{currentDraft.title}</strong>
        <div className={styles.body}>{currentDraft.body}</div>
        <div className={styles.actions}>
          <button type="button" className="btn secondary" disabled={busy} onClick={editSelected}>Edit draft</button>
          {selected.status === 'Draft' ?
            <button type="button" className="btn" disabled={busy} onClick={() => void run(
              () => api.staffGuideSubmit(Number(selected.id)), 'Sent for review.', Number(selected.id),
            )}>Send for review</button> : null}
          {canPublish && selected.status === 'In Review' ?
            <button type="button" className="btn" disabled={busy} onClick={() => void run(
              () => api.staffGuideApprove(Number(selected.id)), 'Guide approved.', Number(selected.id),
            )}>Approve guide</button> : null}
          {canPublish && selected.status === 'Approved' ?
            <button type="button" className="btn" disabled={busy} onClick={() => void run(
              () => api.staffGuidePublish(Number(selected.id)),
              'Published. Affected staff were notified.', Number(selected.id),
            )}>Publish &amp; notify staff</button> : null}
          {canPublish && current ? <button type="button" className="btn secondary" disabled={busy} onClick={() => void run(
            () => api.staffGuideRetire(Number(selected.id)), 'Guide retired.',
          )}>Retire guide</button> : null}
        </div>
      </section> : null}
      {canPublish && current?.requires_ack ? <button type="button" className="btn secondary" disabled={busy} onClick={() => {
        void run(async () => {
          const readers = await api.staffGuideReaders(Number(selected.id));
          setNotice(readers.length + ' assigned readers; ' + readers.filter(row => row.acknowledged_at).length + ' confirmed.');
        }, '');
      }}>Check reading progress</button> : null}
    </section> : null}

    {!selected && editorOpen && tab === 'manage' ? <section className={styles.editor}>
      <h2>{editingId ? 'Edit guide' : 'Create guide'}</h2>
      <p>Saved drafts are not shown to staff. Publishing requires management approval.</p>
      <label>Title<input value={draft.title} maxLength={180} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <div className={styles.two}>
        <label>Type<select value={draft.doc_type} onChange={e => setDraft({ ...draft, doc_type: e.target.value })}>
          {['Quick Guide', 'SOP', 'Policy', 'Emergency'].map(type => <option key={type}>{type}</option>)}
        </select></label>
        <label>Category<input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
      </div>
      <label>Short description<textarea rows={2} value={draft.summary} maxLength={1000} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
      <label>Instructions (one step per line)<textarea rows={12} value={draft.body} maxLength={40000} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
      <label>Who can read this?
        <select value={draft.audience} onChange={e => setDraft({ ...draft, audience: e.target.value, department_ids: [] })}>
          <option value="departments">Selected departments</option>
          {canPublish ? <option value="all">All staff</option> : null}
          {canPublish ? <option value="management">Management only</option> : null}
        </select>
      </label>
      {draft.audience === 'departments' ? <fieldset className={styles.depts}>
        <legend>Select departments</legend>
        {departments.map(d => <label key={d.id}><input type="checkbox"
          checked={draft.department_ids.includes(Number(d.id))}
          onChange={e => setDraft(prev => ({
            ...prev, department_ids: e.target.checked ?
              [...prev.department_ids, Number(d.id)] :
              prev.department_ids.filter(value => value !== Number(d.id)),
          }))} />{d.name}</label>)}
        {!departments.length ? <p>Your departments could not be loaded. Please reload.</p> : null}
      </fieldset> : null}
      <label className={styles.check}><input type="checkbox" checked={draft.requires_ack}
        onChange={e => setDraft({ ...draft, requires_ack: e.target.checked })} />
        Require staff to confirm they have read this version
      </label>
      <div className={styles.actions}>
        <button type="button" className="btn" disabled={busy} onClick={() => void saveDraft()}>Save draft</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => setEditorOpen(false)}>Cancel</button>
      </div>
    </section> : null}

    {!selected && !editorOpen && tab === 'guides' ? <section>
      <form className={styles.search} onSubmit={e => { e.preventDefault(); void run(() => refresh(search), ''); }}>
        <label htmlFor="guide-search">Search a guide</label>
        <div><input id="guide-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Example: guest complaint, room cleaning..." />
        <button type="submit" className="btn" disabled={busy}>Search</button></div>
      </form>
      <h2>Available guides</h2>
      {loading ? <p>Loading guides...</p> : guides.length ? <div className={styles.cards}>
        {guides.map(guide => <button type="button" key={guide.id} className={styles.card} onClick={() => void openGuide(Number(guide.id))}>
          <strong>{guide.title}</strong>
          <span>{guide.summary || 'Open to read the steps.'}</span>
          <small>{guide.doc_type} · {guide.category} · Updated {dateLabel(guide.published_at)}</small>
        </button>)}
      </div> : <p>No published guides match your search yet.</p>}
    </section> : null}

    {!selected && !editorOpen && tab === 'reading' ? <section>
      <h2>My required reading</h2>
      {reading.length ? <div className={styles.cards}>{reading.map(item =>
        <button type="button" key={item.revision_id} className={styles.card} onClick={() => void openGuide(Number(item.document_id))}>
          <strong>{item.title}</strong>
          <span>{item.acknowledged ? 'Completed' : 'Please read and confirm'}</span>
          <small>{item.acknowledged ? 'Confirmed' : 'Due ' + dateLabel(item.due_at)}</small>
        </button>)}</div> : <p>Nothing to confirm right now.</p>}
    </section> : null}

    {!selected && !editorOpen && tab === 'manage' ? <section>
      <h2>Working copies and published guides</h2>
      {managed.length ? <div className={styles.cards}>
        {managed.map(item => <button type="button" key={item.id} className={styles.card} onClick={() => void openGuide(Number(item.id))}>
          <strong>{item.title}</strong><span>{item.status} · Version {item.version}</span>
          <small>{item.doc_type}</small>
        </button>)}
      </div> : <p>No guides have been prepared. Select New guide to begin.</p>}
    </section> : null}
  </div>;
}
