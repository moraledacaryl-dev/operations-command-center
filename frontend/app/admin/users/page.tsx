'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

export default function UsersPage() {
  const [meta, setMeta] = useState<Entity>({ users: [], departments: [] });
  const [data, setData] = useState<Entity>({ user_id: '', department_id: '', is_primary: false, role_override: '' });
  const [saved, setSaved] = useState('');
  async function load() { setMeta(await api.meta()); }
  useEffect(() => { load(); }, []);
  async function addMembership() {
    if (!data.user_id || !data.department_id) return;
    await api.create('user-departments', { ...data, user_id: Number(data.user_id), department_id: Number(data.department_id), is_primary: Boolean(data.is_primary) });
    setSaved('Dept added');
    setData({ user_id: '', department_id: '', is_primary: false, role_override: '' });
    await load();
  }
  return <>
    <Top eyebrow="Admin" title="Users" />
    <div className="panel" style={{ marginBottom: 16 }}>
      <h2>Add dept access</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">User<select className="select" value={data.user_id} onChange={e => setData({ ...data, user_id: e.target.value })}><option value="">Select</option>{meta.users?.map((u: Entity) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select></label>
        <label className="label">Department<select className="select" value={data.department_id} onChange={e => setData({ ...data, department_id: e.target.value })}><option value="">Select</option>{meta.departments?.map((d: Entity) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="label">Role note<input className="input" value={data.role_override || ''} onChange={e => setData({ ...data, role_override: e.target.value })} placeholder="optional" /></label>
        <label className="label inline"><input type="checkbox" checked={!!data.is_primary} onChange={e => setData({ ...data, is_primary: e.target.checked })} /> Primary</label>
      </div>
      <div className="toolbar"><button className="btn" onClick={addMembership}>Save</button>{saved ? <Pill value={saved} /> : null}</div>
    </div>
    <div className="grid cols-2">
      {meta.users?.map((u: Entity) => <div className="card" key={u.id}>
        <div className="card-title">{u.name}</div>
        <div className="card-line"><Pill value={u.role} />{u.departments?.map((d: Entity) => <Pill key={d.id} value={`${d.name}${d.is_primary ? ' · primary' : ''}`} />)}</div>
        <span className="muted">{u.email}</span>
      </div>)}
    </div>
  </>;
}
