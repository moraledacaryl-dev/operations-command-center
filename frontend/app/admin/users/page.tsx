'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';
import { LoadingPanel } from '@/components/LoadingPanel';

const EMPTY_CREATE: Entity = { name: '', email: '', role: 'manager', department_id: '', password: '', is_active: true };

type Mode = 'create' | 'edit' | 'reset' | 'access' | '';

function localDate(value?: string) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function UsersPage() {
  const [directory, setDirectory] = useState<Entity[]>([]);
  const [meta, setMeta] = useState<Entity>({ departments: [] });
  const [mode, setMode] = useState<Mode>('');
  const [selected, setSelected] = useState<Entity | null>(null);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [membership, setMembership] = useState<Entity>({ user_id: '', department_id: '', is_primary: false, role_override: '' });
  const [createForm, setCreateForm] = useState<Entity>(EMPTY_CREATE);
  const [resetForm, setResetForm] = useState<Entity>({ user_id: '', new_password: '' });
  const [editForm, setEditForm] = useState<Entity>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [confirmMembershipId, setConfirmMembershipId] = useState<number | null>(null);

  const load = useCallback(async (cursor?: string | null, searchQuery = '') => {
    if (!cursor) setInitialLoading(true);
    try {
      const [page, operationalMeta] = await Promise.all([api.usersPage({ active: false, limit: 30, cursor: cursor || '', q: searchQuery }), api.meta()]);
      setDirectory(existing => cursor ? [...existing, ...page.items] : page.items);
      setNextCursor(page.next_cursor || null);
      setMeta(operationalMeta);
    } finally { if (!cursor) setInitialLoading(false); }
  }, []);

  useEffect(() => { load().catch((err: any) => setError(err.message || 'Could not load users.')); }, [load]);

  async function searchDirectory(nextQuery: string) {
    const normalized = nextQuery.trim();
    setAppliedQuery(normalized);
    setError('');
    try { await load(null, normalized); } catch (err: any) { setError(err.message || 'Could not search users.'); }
  }

  function open(modeName: Mode, user?: Entity) {
    setError(''); setSaved(''); setMode(modeName); setSelected(user || {});
    if (modeName === 'reset' && user) setResetForm({ user_id: user.id, new_password: '' });
    if (modeName === 'access' && user) setMembership({ user_id: user.id, department_id: '', is_primary: false, role_override: '' });
    if (modeName === 'edit' && user) setEditForm({ name: user.name, email: user.email, role: user.role, is_active: user.is_active });
    setConfirmMembershipId(null);
  }

  function close() { if (!busy) { setMode(''); setSelected(null); } }

  function closeAfterSuccess(message: string) {
    setBusy(false);
    setSaved(message);
    setMode('');
    setSelected(null);
  }

  async function createUser() {
    if (!createForm.name || !createForm.email || !createForm.password || busy) return;
    setBusy(true); setError('');
    try {
      await api.adminCreateUser({ ...createForm, department_id: createForm.department_id ? Number(createForm.department_id) : null });
      setCreateForm(EMPTY_CREATE);
      await load(null, appliedQuery);
      closeAfterSuccess('User created.');
    } catch (err: any) { setError(err.message || 'Could not create user.'); setBusy(false); }
  }

  async function resetPassword() {
    if (!resetForm.user_id || !resetForm.new_password || busy) return;
    setBusy(true); setError('');
    try {
      await api.adminResetUserPassword(Number(resetForm.user_id), resetForm.new_password);
      setResetForm({ user_id: '', new_password: '' });
      await load(null, appliedQuery);
      closeAfterSuccess('Password reset saved.');
    } catch (err: any) { setError(err.message || 'Could not reset password.'); setBusy(false); }
  }

  async function updateUser() {
    if (!selected?.id || !editForm.name || !editForm.email || busy) return;
    setBusy(true); setError('');
    try {
      await api.adminUpdateUser(Number(selected.id), editForm);
      await load(null, appliedQuery);
      closeAfterSuccess('Account updated. Existing sessions were revoked when access changed.');
    } catch (err: any) { setError(err.message || 'Could not update account.'); setBusy(false); }
  }

  async function makePrimary(membershipId: number) {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.adminUpdateMembership(membershipId, { is_primary: true }); await load(null, appliedQuery); closeAfterSuccess('Primary department updated.'); }
    catch (err: any) { setError(err.message || 'Could not update department access.'); setBusy(false); }
  }

  async function removeMembership(membershipId: number) {
    if (confirmMembershipId !== membershipId) { setConfirmMembershipId(membershipId); return; }
    setBusy(true); setError('');
    try { await api.adminDeleteMembership(membershipId); await load(null, appliedQuery); closeAfterSuccess('Department access removed.'); }
    catch (err: any) { setError(err.message || 'Could not remove department access.'); setBusy(false); }
  }

  async function addMembership() {
    if (!membership.user_id || !membership.department_id || busy) return;
    setBusy(true); setError('');
    try {
      await api.create('user-departments', { ...membership, user_id: Number(membership.user_id), department_id: Number(membership.department_id), is_primary: Boolean(membership.is_primary) });
      setMembership({ user_id: '', department_id: '', is_primary: false, role_override: '' });
      await load(null, appliedQuery);
      closeAfterSuccess('Department access saved.');
    } catch (err: any) { setError(err.message || 'Could not add department access.'); setBusy(false); }
  }

  const activeDrawerError = mode && error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null;

  return <>
    <Top eyebrow="Administration" title="People & access" right={<button className="btn" onClick={() => open('create')}>Create user</button>} />
    {!mode && error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {saved ? <div className="pill ok" role="status" style={{ marginBottom: 12 }}>{saved}</div> : null}

    <section className="panel people-controls" style={{ marginBottom: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input className="input" placeholder="Search name, email, or role" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void searchDirectory(query); }} />
        <button className="btn secondary" onClick={() => void searchDirectory(query)}>Search</button>
        {(query || appliedQuery) ? <button className="btn secondary" onClick={() => { setQuery(''); void searchDirectory(''); }}>Clear</button> : null}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>{directory.length} account{directory.length === 1 ? '' : 's'} loaded{appliedQuery ? ` for “${appliedQuery}”` : ''}. Password and access actions open in protected drawers.</p>
    </section>

    {initialLoading ? <LoadingPanel label="Loading accounts and access…" /> : <div className="grid cols-2">
      {directory.map(user => <article className="card person-card" key={user.id}>
        <div className="card-title">{user.name}</div>
        <div className="card-line"><Pill value={user.role} />{!user.is_active ? <Pill value="Inactive" /> : <Pill value="Active" />}{user.departments?.map((department: Entity) => <Pill key={department.id} value={`${department.name}${department.is_primary ? ' · primary' : ''}`} />)}</div>
        <span className="muted">{user.email}</span>
        <div className="card-line" style={{ marginTop: 8 }}><span className="muted">Last login: {localDate(user.last_login_at)}</span></div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn small secondary" onClick={() => open('access', user)}>Department access</button>
          <button className="btn small secondary" onClick={() => open('edit', user)}>Edit account</button>
          <button className="btn small secondary" onClick={() => open('reset', user)}>Reset password</button>
        </div>
      </article>)}
      {!directory.length ? <div className="empty">No matching accounts.</div> : null}
    </div>}
    {nextCursor ? <div className="load-more"><button className="btn secondary" disabled={loadingMore} onClick={async () => { setLoadingMore(true); try { await load(nextCursor, appliedQuery); } catch (err: any) { setError(err.message || 'Could not load more users.'); } finally { setLoadingMore(false); } }}>{loadingMore ? 'Loading…' : 'Load more accounts'}</button><span className="muted" aria-live="polite">{directory.length} accounts loaded</span></div> : null}

    <Drawer item={selected} title={mode === 'create' ? 'Create user' : mode === 'edit' ? 'Edit account' : mode === 'reset' ? 'Reset password' : mode === 'access' ? 'Department access' : 'People & access'} onClose={close}>
      {activeDrawerError}
      {mode === 'create' ? <section className="panel">
        <h2>New account</h2><p className="muted">Create the identity first. Additional department access can be added afterward.</p>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="label">Name<input className="input" value={createForm.name} onChange={event => setCreateForm({ ...createForm, name: event.target.value })} /></label>
          <label className="label">Email<input className="input" type="email" value={createForm.email} onChange={event => setCreateForm({ ...createForm, email: event.target.value })} /></label>
          <label className="label">Role<select className="select" value={createForm.role} onChange={event => setCreateForm({ ...createForm, role: event.target.value })}>{['owner', 'admin', 'manager', 'lead', 'supervisor', 'staff'].map(role => <option key={role}>{role}</option>)}</select></label>
          <label className="label">Primary department<select className="select" value={createForm.department_id} onChange={event => setCreateForm({ ...createForm, department_id: event.target.value })}><option value="">Optional</option>{meta.departments?.map((department: Entity) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className="label">Temporary password<input className="input" type="password" value={createForm.password} onChange={event => setCreateForm({ ...createForm, password: event.target.value })} /></label>
          <label className="label inline"><input type="checkbox" checked={!!createForm.is_active} onChange={event => setCreateForm({ ...createForm, is_active: event.target.checked })} /> Active account</label>
        </div>
        <div className="toolbar"><button className="btn" disabled={busy || !createForm.name || !createForm.email || !createForm.password} onClick={createUser}>{busy ? 'Creating…' : 'Create account'}</button></div>
      </section> : null}

      {mode === 'reset' ? <section className="panel">
        <h2>Reset {selected?.name || 'user'} password</h2><p className="muted">This is a security-sensitive action and may invalidate existing sessions.</p>
        <label className="label">New password<input className="input" type="password" value={resetForm.new_password} onChange={event => setResetForm({ ...resetForm, new_password: event.target.value })} /></label>
        <div className="toolbar"><button className="btn" disabled={busy || !resetForm.new_password} onClick={resetPassword}>{busy ? 'Resetting…' : 'Confirm password reset'}</button></div>
      </section> : null}

      {mode === 'edit' ? <section className="panel">
        <h2>Edit {selected?.name || 'account'}</h2><p className="muted">Role or active-state changes revoke existing sessions.</p>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="label">Name<input className="input" value={String(editForm.name || '')} onChange={event => setEditForm({ ...editForm, name: event.target.value })} /></label>
          <label className="label">Email<input className="input" type="email" value={String(editForm.email || '')} onChange={event => setEditForm({ ...editForm, email: event.target.value })} /></label>
          <label className="label">Role<select className="select" value={String(editForm.role || 'staff')} onChange={event => setEditForm({ ...editForm, role: event.target.value })}>{['owner', 'admin', 'manager', 'lead', 'supervisor', 'staff'].map(role => <option key={role}>{role}</option>)}</select></label>
          <label className="label inline"><input type="checkbox" checked={Boolean(editForm.is_active)} onChange={event => setEditForm({ ...editForm, is_active: event.target.checked })} /> Active account</label>
        </div>
        <div className="toolbar"><button className="btn" disabled={busy || !editForm.name || !editForm.email} onClick={updateUser}>{busy ? 'Saving…' : 'Save account'}</button></div>
      </section> : null}

      {mode === 'access' ? <section className="panel">
        <h2>Add access for {selected?.name || 'user'}</h2>
        <div className="grid" style={{ marginBottom: 16 }}>{(selected?.departments || []).map((department: Entity) => <div className="card" key={department.membership_id || department.id}><div className="card-line"><strong>{department.name}</strong>{department.is_primary ? <Pill value="Primary" /> : null}</div>{department.membership_id ? <div className="toolbar" style={{ marginBottom: 0 }}>{!department.is_primary ? <button className="btn small secondary" disabled={busy} onClick={() => makePrimary(Number(department.membership_id))}>Make primary</button> : null}<button className="btn small secondary" disabled={busy} onClick={() => removeMembership(Number(department.membership_id))}>{confirmMembershipId === Number(department.membership_id) ? 'Confirm remove' : 'Remove access'}</button></div> : <span className="muted">Legacy primary membership</span>}</div>)}</div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="label">Department<select className="select" value={membership.department_id} onChange={event => setMembership({ ...membership, department_id: event.target.value })}><option value="">Select</option>{meta.departments?.map((department: Entity) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className="label">Role note<input className="input" value={membership.role_override || ''} onChange={event => setMembership({ ...membership, role_override: event.target.value })} placeholder="Optional department-specific note" /></label>
          <label className="label inline"><input type="checkbox" checked={!!membership.is_primary} onChange={event => setMembership({ ...membership, is_primary: event.target.checked })} /> Make primary department</label>
        </div>
        <div className="toolbar"><button className="btn" disabled={busy || !membership.department_id} onClick={addMembership}>{busy ? 'Saving…' : 'Save department access'}</button></div>
      </section> : null}
    </Drawer>
  </>;
}
