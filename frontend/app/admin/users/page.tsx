'use client';
import { useEffect, useMemo, useState } from 'react';
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

const ALL_ROLES = ['owner', 'admin', 'manager', 'supervisor', 'lead', 'staff'];
const ADMIN_CREATE_ROLES = ['manager', 'supervisor', 'lead', 'staff'];
const SENSITIVE_ROLES = ['owner', 'admin'];

function generatePassword() {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 18);
  return `HO-${token}-Aa1!`;
}

function roleOf(user?: Entity | null) {
  return String(user?.role || '').toLowerCase();
}

function isSensitive(user?: Entity | null) {
  return SENSITIVE_ROLES.includes(roleOf(user));
}

function canManageUser(currentUser: Entity | null, target: Entity) {
  if (!currentUser) return false;
  if (roleOf(currentUser) === 'owner') return true;
  return !isSensitive(target);
}

function sameUser(a?: Entity | null, b?: Entity | null) {
  return Number(a?.id || 0) === Number(b?.id || 0);
}

export default function UsersPage() {
  const [currentUser, setCurrentUser] = useState<Entity | null>(null);
  const [meta, setMeta] = useState<Entity>({ users: [], departments: [] });
  const [membership, setMembership] = useState<Entity>({ user_id: '', department_id: '', is_primary: false, role_override: '' });
  const [createForm, setCreateForm] = useState<Entity>(EMPTY_CREATE);
  const [resetForm, setResetForm] = useState<Entity>({ user_id: '', new_password: '' });
  const [generatedCreatePassword, setGeneratedCreatePassword] = useState('');
  const [generatedResetPassword, setGeneratedResetPassword] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const users = meta.users || [];
  const roleOptions = roleOf(currentUser) === 'owner' ? ALL_ROLES : ADMIN_CREATE_ROLES;
  const resetCandidates = users.filter((u: Entity) => canManageUser(currentUser, u) && !sameUser(currentUser, u));
  const manageableUsers = users.filter((u: Entity) => canManageUser(currentUser, u));
  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((u: Entity) => {
      const matchesRole = roleFilter === 'all' || roleOf(u) === roleFilter;
      const haystack = `${u.name || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase();
      return matchesRole && (!needle || haystack.includes(needle));
    });
  }, [users, search, roleFilter]);

  async function load() {
    const [nextMeta, me] = await Promise.all([api.meta(), api.me()]);
    setMeta(nextMeta);
    setCurrentUser(me);
  }

  useEffect(() => {
    load().catch((err: any) => setError(err.message || 'Could not load users.'));
  }, []);

  async function addMembership() {
    if (!membership.user_id || !membership.department_id) {
      setError('Select a user and department.');
      return;
    }
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
    if (!createForm.name || !createForm.email || !createForm.password) {
      setError('Name, email, and password are required.');
      return;
    }
    setError('');
    setSaved('');
    try {
      await api.adminCreateUser({
        ...createForm,
        department_id: createForm.department_id ? Number(createForm.department_id) : null,
      });
      setSaved('User created.');
      setOneTimePassword(createForm.password === generatedCreatePassword ? createForm.password : '');
      setCreateForm({ ...EMPTY_CREATE, role: roleOptions.includes('manager') ? 'manager' : roleOptions[0] });
      setGeneratedCreatePassword('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not create user.');
    }
  }

  async function resetPassword() {
    if (!resetForm.user_id || !resetForm.new_password) {
      setError('Select a user and enter a new password.');
      return;
    }
    setError('');
    setSaved('');
    try {
      await api.adminResetUserPassword(Number(resetForm.user_id), resetForm.new_password);
      setSaved('Password reset saved.');
      setOneTimePassword(resetForm.new_password === generatedResetPassword ? resetForm.new_password : '');
      setResetForm({ user_id: '', new_password: '' });
      setGeneratedResetPassword('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not reset password.');
    }
  }

  async function toggleActive(target: Entity) {
    setError('');
    setSaved('');
    try {
      await api.update('users', Number(target.id), { is_active: !target.is_active });
      setSaved(`${target.name} ${target.is_active ? 'deactivated' : 'activated'}.`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not update user.');
    }
  }

  function fillCreatePassword() {
    const password = generatePassword();
    setGeneratedCreatePassword(password);
    setCreateForm({ ...createForm, password });
  }

  function fillResetPassword() {
    const password = generatePassword();
    setGeneratedResetPassword(password);
    setResetForm({ ...resetForm, new_password: password });
  }

  const activeCount = users.filter((u: Entity) => u.is_active).length;
  const inactiveCount = users.length - activeCount;
  const adminCount = users.filter((u: Entity) => SENSITIVE_ROLES.includes(roleOf(u))).length;
  const noDepartmentCount = users.filter((u: Entity) => !(u.departments || []).length).length;

  return <>
    <Top eyebrow="Admin" title="Users" />
    {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    {saved ? <div className="pill ok" style={{ marginBottom: 12 }}>{saved}</div> : null}
    {oneTimePassword ? (
      <section className="panel one-time-password">
        <div>
          <h2>Temporary password</h2>
          <p className="muted">Shown once. Share privately.</p>
        </div>
        <code>{oneTimePassword}</code>
      </section>
    ) : null}

    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="section-head">
        <h2>Access</h2>
        <div className="card-line">
          <Pill value={roleOf(currentUser) === 'owner' ? 'Owner controls all roles' : 'Admin controls staff roles'} />
          <Pill value={`${users.length} users`} />
        </div>
      </div>
      <div className="health-metrics">
        <div><span>active</span><b>{activeCount}</b></div>
        <div><span>inactive</span><b>{inactiveCount}</b></div>
        <div><span>owner/admin</span><b>{adminCount}</b></div>
        <div><span>no dept</span><b>{noDepartmentCount}</b></div>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Search<input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="name or email" /></label>
        <label className="label">Role
          <select className="select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="all">All</option>
            {ALL_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
      </div>
    </section>

    <div className="grid cols-2" style={{ marginBottom: 16 }}>
      <section className="panel">
        <h2>Create user</h2>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="label">Name<input className="input" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} /></label>
          <label className="label">Email<input className="input" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} /></label>
          <label className="label">Role
            <select className="select" value={createForm.role} onChange={e => setCreateForm({ ...createForm, role: e.target.value })}>
              {roleOptions.map(role => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label className="label">Primary department
            <select className="select" value={createForm.department_id} onChange={e => setCreateForm({ ...createForm, department_id: e.target.value })}>
              <option value="">Optional</option>
              {meta.departments?.map((dept: Entity) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
            </select>
          </label>
          <label className="label">Password
            <div className="input-action">
              <input className="input" type="text" value={createForm.password} onChange={e => { setGeneratedCreatePassword(''); setCreateForm({ ...createForm, password: e.target.value }); }} />
              <button className="btn small secondary" type="button" onClick={fillCreatePassword}>Generate</button>
            </div>
          </label>
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
              {resetCandidates.map((candidate: Entity) => <option key={candidate.id} value={candidate.id}>{candidate.name} - {candidate.email}</option>)}
            </select>
          </label>
          <label className="label">New password
            <div className="input-action">
              <input className="input" type="text" value={resetForm.new_password} onChange={e => { setGeneratedResetPassword(''); setResetForm({ ...resetForm, new_password: e.target.value }); }} />
              <button className="btn small secondary" type="button" onClick={fillResetPassword}>Generate</button>
            </div>
          </label>
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
            {manageableUsers.map((u: Entity) => <option key={u.id} value={u.id}>{u.name} - {u.role}</option>)}
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
      {filteredUsers.map((u: Entity) => {
        const manageAllowed = canManageUser(currentUser, u);
        const isSelf = sameUser(currentUser, u);
        const toggleAllowed = manageAllowed && !isSelf;
        return (
          <div className="card" key={u.id}>
            <div className="section-head">
              <div>
                <div className="card-title">{u.name}</div>
                <span className="muted">{u.email}</span>
              </div>
              <div className="card-line">
                <Pill value={u.role} />
                <Pill value={u.is_active ? 'active' : 'inactive'} />
              </div>
            </div>
            <div className="card-line">
              {(u.departments || []).length ? u.departments.map((d: Entity) => <Pill key={d.id} value={`${d.name}${d.is_primary ? ' primary' : ''}`} />) : <Pill value="no department" />}
            </div>
            <div className="card-line" style={{ marginTop: 4 }}>
              <span className="muted">Password set: {u.password_set_at || 'not set'}</span>
            </div>
            <div className="card-line">
              <span className="muted">Last login: {u.last_login_at || 'never'}</span>
            </div>
            <div className="toolbar" style={{ marginBottom: 0, marginTop: 4 }}>
              <button className="btn small secondary" disabled={!toggleAllowed} onClick={() => toggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
              {isSelf ? <span className="muted">Current user</span> : null}
              {!manageAllowed ? <span className="muted">Owner-only</span> : null}
            </div>
          </div>
        );
      })}
      {!filteredUsers.length ? <div className="empty">No users found</div> : null}
    </div>
  </>;
}
