'use client';
import { useEffect, useState } from 'react';
import { API_BASE, api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';

const statuses = ['Idea', 'Draft', 'Review', 'Fix', 'OK', 'Set', 'Posted'];
const filters = ['All', 'Idea', 'Draft', 'Review', 'Fix', 'OK', 'Set', 'Posted'];
const platforms = ['Facebook', 'Instagram', 'TikTok', 'Google Business', 'Website'];
const types = ['Reel', 'Story', 'Static', 'Carousel', 'Ad', 'Blog'];

const blank: Entity = { title: '', platform: 'Facebook', content_type: 'Reel', post_date: '', status: 'Idea', caption: '', campaign: '' };

function PostCard({ item, onOpen }: { item: Entity; onOpen: () => void }) {
  return (
    <div className="card" onClick={onOpen}>
      <div className="card-title">{item.title}</div>
      <div className="card-line"><Pill value={item.platform} /><Pill value={item.status} /><Pill value={item.post_date ? String(item.post_date).slice(0, 10) : ''} /></div>
      {item.caption ? <div className="muted" style={{ fontSize: 13 }}>{String(item.caption).slice(0, 90)}</div> : null}
    </div>
  );
}

function assetHref(url?: string) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads')) return `${API_BASE.replace('/api', '')}${url}`;
  return url;
}

export default function PostsPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [versions, setVersions] = useState<Entity[]>([]);
  const [filter, setFilter] = useState('All');
  const [showAdd, setShowAdd] = useState(false);
  const [data, setData] = useState<Entity>(blank);
  const [comment, setComment] = useState('');
  const [version, setVersion] = useState({ filename: '', file_url: '', note: '', caption_snapshot: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [currentDeptId, setCurrentDeptId] = useState<number | null>(null);

  async function load() {
    setError('');
    try {
      const rows = await api.list('posts', { active: true, status: filter === 'All' ? '' : filter, department_id: currentDeptId || '' });
      setItems(rows);
    } catch (err: any) {
      setError(err.message || 'Could not load posts.');
    }
  }
  useEffect(() => { const user = getStoredUser(); setCurrentDeptId(getCurrentDepartmentId(user)); }, []);
  useEffect(() => { load(); }, [filter, currentDeptId]);

  async function open(item: Entity) {
    const fresh = await api.get('posts', item.id);
    setSelected(fresh);
    setVersions(await api.versions(item.id));
  }
  async function create() {
    if (!String(data.title || '').trim()) {
      setError('Title is required.');
      return;
    }
    try {
      await api.create('posts', currentDeptId && !data.department_id ? { ...data, department_id: currentDeptId } : data);
      setData(blank);
      setShowAdd(false);
      load();
    } catch (err: any) {
      setError(err.message || 'Could not save post.');
    }
  }
  async function setStatus(status: string) {
    if (!selected) return;
    try {
      const updated = await api.status('posts', selected.id, status);
      const fresh = await api.get('posts', selected.id);
      setSelected({ ...fresh, ...updated });
      load();
    } catch (err: any) {
      setError(err.message || 'Could not update post.');
    }
  }
  async function addComment() {
    if (!selected || !comment.trim()) return;
    await api.comment('posts', selected.id, comment.trim(), 'General');
    await open(selected);
    setComment('');
  }
  async function addVersion() {
    if (!selected) return;
    try {
      const form = new FormData();
      Object.entries(version).forEach(([k, v]) => form.append(k, v));
      if (file) form.append('file', file);
      await api.addVersion(selected.id, form);
      setVersion({ filename: '', file_url: '', note: '', caption_snapshot: '' });
      setFile(null);
      await open(selected);
      load();
    } catch (err: any) {
      setError(err.message || 'Could not add version.');
    }
  }

  return (
    <>
      <Top eyebrow="Calendar" title="Posts" right={<button className="btn" onClick={() => setShowAdd(s => !s)}>Add</button>} />
      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
      <div className="tabs">{filters.map(f => <button key={f} onClick={() => setFilter(f)} className={`tab ${filter === f ? 'active' : ''}`}>{f}</button>)}</div>
      {showAdd && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Add Post</h2>
          <div className="form" style={{ marginTop: 14 }}>
            <div className="form-grid">
              <label className="label">Title<input className="input" value={data.title} onChange={e => setData({ ...data, title: e.target.value })} /></label>
              <label className="label">Platform<select className="select" value={data.platform} onChange={e => setData({ ...data, platform: e.target.value })}>{platforms.map(x => <option key={x}>{x}</option>)}</select></label>
              <label className="label">Type<select className="select" value={data.content_type} onChange={e => setData({ ...data, content_type: e.target.value })}>{types.map(x => <option key={x}>{x}</option>)}</select></label>
              <label className="label">Date<input type="date" className="input" value={data.post_date} onChange={e => setData({ ...data, post_date: e.target.value })} /></label>
              <label className="label">Status<select className="select" value={data.status} onChange={e => setData({ ...data, status: e.target.value })}>{statuses.map(x => <option key={x}>{x}</option>)}</select></label>
              <label className="label">Campaign<input className="input" value={data.campaign} onChange={e => setData({ ...data, campaign: e.target.value })} /></label>
            </div>
            <label className="label">Caption<textarea className="textarea" value={data.caption} onChange={e => setData({ ...data, caption: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={create}>Save</button><button className="btn secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
          </div>
        </div>
      )}
      <div className="grid cols-3">{items.length ? items.map(item => <PostCard key={item.id} item={item} onOpen={() => open(item)} />) : <div className="empty">No posts</div>}</div>
      <Drawer item={selected} onClose={() => setSelected(null)}>
        <div className="workflow-panel">
          <div>
            <div className="eyebrow">Next step</div>
            <h2>Marketing review loop</h2>
          </div>
          <div className="workflow-actions">
            <button className="btn small" onClick={() => setStatus('Review')}>Submit review</button>
            <button className="btn small secondary" onClick={() => setStatus('OK')}>Approve creative</button>
            <button className="btn small secondary" onClick={() => setStatus('Fix')}>Needs fix</button>
            <button className="btn small secondary" onClick={() => setStatus('Posted')}>Mark posted</button>
          </div>
        </div>
        <div className="panel">
          <h2>Review</h2>
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            {statuses.map(s => <button key={s} className="btn small secondary" onClick={() => setStatus(s)}>{s}</button>)}
          </div>
        </div>
        <div className="panel" style={{ marginTop: 16 }}>
          <h2>Upload</h2>
          <div className="form" style={{ marginTop: 12 }}>
            <div className="form-grid">
              <label className="label">File<input className="input" type="file" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
              <label className="label">URL<input className="input" value={version.file_url} onChange={e => setVersion({ ...version, file_url: e.target.value })} /></label>
            </div>
            <label className="label">Display name<input className="input" value={version.filename} onChange={e => setVersion({ ...version, filename: e.target.value })} /></label>
            <label className="label">Caption<textarea className="textarea" value={version.caption_snapshot} onChange={e => setVersion({ ...version, caption_snapshot: e.target.value })} /></label>
            <label className="label">Note<textarea className="textarea" value={version.note} onChange={e => setVersion({ ...version, note: e.target.value })} /></label>
            <button className="btn secondary" onClick={addVersion}>Add V</button>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            {versions.map(v => <div className="version" key={v.id}><b>V{v.version_no} {v.is_current ? '· Current' : ''}</b><span>{v.filename}</span>{v.file_url ? <a className="btn small secondary" href={assetHref(v.file_url)} target="_blank" rel="noreferrer">Open asset</a> : null}<span className="muted">{v.note}</span></div>)}
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
