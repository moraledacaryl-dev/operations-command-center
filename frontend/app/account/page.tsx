'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { clearStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';

export default function AccountPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setSaved('');
    if (!currentPassword || !newPassword) {
      setError('Enter your current password and a new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSaved('Password updated. Sign in again with the new password.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      clearStoredUser();
      window.setTimeout(() => router.replace('/login?password=changed'), 500);
    } catch (err: any) {
      setError(err.message || 'Could not change password.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Top eyebrow="Account" title="Security" />
    <section className="panel" style={{ maxWidth: 720 }}>
      <h2>Change password</h2>
      <p className="muted">Use a long passphrase or a strong mixed password with at least 12 characters.</p>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="label">Current password<input className="input" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
        <label className="label">New password<input className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
        <label className="label">Confirm new password<input className="input" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} /></label>
      </div>
      {error ? <div className="pill urgent" style={{ marginTop: 12 }}>{error}</div> : null}
      {saved ? <div className="pill ok" style={{ marginTop: 12 }}>{saved}</div> : null}
      <div className="toolbar">
        <button className="btn" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </div>
    </section>
  </>;
}
