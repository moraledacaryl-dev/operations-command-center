'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

const EMPTY_CREATE = {
  name: '',
  email: '',
  role: 'manager',
  department_id: '',
  password: '',
  is_active: true,
};

export default function UsersPage() {
  const [meta, setMeta] = useState<Entity>({ users: [], departments: [] });
  const [membership, setMembership] = useState<Entity>({ user_id: '', department_id: '', is_primary: false, role_override: '' });
  const [createForm, setCreateForm] = useState<Entity>(EMPTY_CREATE);
  const [resetForm, setResetForm] = useState<Entity>({ user_id: '', new_password: '' });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  async function load() {
    setMeta(await api.meta());
  }

  useEffect(() => {
    load().catch((err: any) => setError(err.message || 'Could not load users.'));
  }, []);

  async function addMembership() {
    if (!membership.user_id || !membership.department_id) return;
    setError('');
    setSaved('');
    try {
      await api.create('user-departments', {
        ...membership,
        user_id: Number(membership.user_id),
        department_id: Number(membership.department_id),
        is_primary: Boolean(membership.is_primary),
      });
      setSaved('Department access saved.');
      setMembership({ user_id: '', department_id: '', is_primary: false, role_override: '' });
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not add department access.');
    }
  }

  async function createUser() {
    if (!createForm.name || !createForm.email || !createForm.password) return;
    setError('');
    setSaved('');
    try {
      await api.adminCreateUser({
        ...createForm,
        department_id: createForm.department_id ? Number(createForm.department_id) : null,
      });
      setSaved('User created.');
      setCreateForm(EMPTY_CREATE);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not create user.');
    }
  }

  async function resetPassword() {
    if (!resetForm.user_id || !resetForm.new_password) return;
    setError('');
    setSaved('');
    try {
      await api.adminResetUserPassword(Number(resetForm.user_id), resetForm.new_password);
      setSaved('Password reset saved.');
      setResetForm({ user_id: '', new_password: '' });
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not reset password.');
    }
  }

  return <>
    <Top eyebrow="Admin" title="Users" />
    {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    {saved ? <div className="pill ok" style={{ marginBottom: 12 }}>{saved}</div> : null}

    <div className="grid cols-2" style={{ marginBottom: 16 }}>
      <section className="panel">
        <h2>Create user</h2>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="label">Name<input className="input" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} /></label>
          <label className="label">Email<input className="input" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} /></label>
          <label className="label">Role
            <select className="select" value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })}>
              {['owner', 'admin', 'manager', 'lead'].map(role => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label className="label">Primary department
            <select className="select" value={createForm.department_id} onChange={e => setCreateForm({ ...createForm, department_id: e.target.value })}>
              <option value="">Optional</option>
              {meta.departments?.map((dept: Entity) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
            </select>
          </label>
          <label className="label">Password<input className="input" type="password" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} /></label>
          <label className="label inline"><input type="checkbox" checked={!!createForm.is_active} onChange={e => setCreateForm({ ...createForm, is_active: e.target.checked })} /> Active</label>
        </div>
        <div className="toolbar"><button className="btn" onClick={createUser}>Create user</button></div>
      </section>

      <section className="panel">
        <h2>Reset password</h2>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="label">User
            <select className="select" value={resetForm.user_id} onChange={e => setResetForm({ ...resetForm, user_id: e.target.value })}>
              <option value="">Select</option>
              {meta.users?.map((candidate: Entity) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.email}</option>)}
            </select>
          </label>
          <label className="label">New password<input className="input" type="password" value={resetForm.new_password} onChange={e => setResetForm({ ...resetForm, new_password: e.target.value })} /></label>
        </div>
        <div className="toolbar"><button className="btn secondary" onClick={resetPassword}>Reset password</button></div>
      </section>
    </div>

    <section className="panel" style={{ marginBottom: 16 }}>
      <h2>Add department access</h2>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">User
          <select className="select" value={membership.user_id} onChange={e => setMembership({ ...membership, user_id: e.target.value })}>
            <option value="">Select</option>
            {meta.users?.map((u: Entity) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </label>
        <label className="label">Department
          <select className="select" value={membership.department_id} onChange={e => setMembership({ ...membership, department_id: e.target.value })}>
            <option value="">Select</option>
            {meta.departments?.map((d: Entity) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="label">Role note<input className="input" value={membership.role_override || ''} onChange={e => setMembership({ ...membership, role_override: e.target.value })} placeholder="optional" /></label>
        <label className="label inline"><input type="checkbox" checked={!!membership.is_primary} onChange={e => setMembership({ ...membership, is_primary: e.target.checked })} /> Primary</label>
      </div>
      <div className="toolbar"><button className="btn secondary" onClick={addMembership}>Save access</button></div>
    </section>

    <div className="grid cols-2">
      {meta.users?.map((u: Entity) => <div className="card" key={u.id}>
        <div className="card-title">{u.name}</div>
        <div className="card-line">
          <Pill value={u.role} />
          {!u.is_active ? <Pill value="inactive" /> : null}
          {u.departments?.map((d: Entity) => <Pill key={d.id} value={`${d.name}${d.is_primary ? ' · primary' : ''}`} />)}
        </div>
        <span className="muted">{u.email}</span>
        <div className="card-line" style={{ marginTop: 8 }}>
          <span className="muted">Password set: {u.password_set_at || 'not set'}</span>
        </div>
        <div className="card-line">
          <span className="muted">Last login: {u.last_login_at || 'never'}</span>
        </div>
      </div>)}
    </div>
  </>;
}
