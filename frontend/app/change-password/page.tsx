'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { clearStoredUser } from '@/lib/session';

export default function FirstPasswordPage() {
  const router = useRouter();
  const [temporary, setTemporary] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || signingOut) return;
    setError('');
    if (password !== confirm) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.changePassword(temporary, password);
      clearStoredUser();
      router.replace('/login?password=changed');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not change your password. Please try again.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (busy || signingOut) return;
    setSigningOut(true); setError('');
    try {
      await api.logout();
      clearStoredUser();
      router.replace('/login');
    } catch {
      setError('Could not sign out. Check your connection and try again.');
    } finally { setSigningOut(false); }
  }

  return <main className="auth-screen">
    <section className="auth-context" aria-label="Hidden Oasis Operations">
      <div className="auth-brand"><span className="logo big" aria-hidden="true">HO</span><span><strong>Hidden Oasis</strong><small>Operations</small></span></div>
      <h1>Choose your password</h1>
    </section>
    <section className="auth-form-panel" aria-labelledby="password-title">
      <div className="auth-mobile-brand"><span className="logo big" aria-hidden="true">HO</span><span><strong>Hidden Oasis</strong><small>Operations</small></span></div>
      <div><h2 id="password-title">Change your temporary password</h2><p>Choose a password only you know. You will use it the next time you sign in.</p><p>Use at least 12 characters and include at least three of these: a lowercase letter, a capital letter, a number, or a symbol.</p></div>
      <form className="form" onSubmit={submit}>
        <label className="label">Temporary password<input className="input" type="password" autoComplete="current-password" required value={temporary} onChange={e => setTemporary(e.target.value)} /></label>
        <label className="label">New password<input className="input" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label className="label">Confirm new password<input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="btn auth-submit" disabled={busy || signingOut}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
      <button type="button" className="btn secondary" disabled={busy || signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out and use another account'}</button>
      <small className="muted">Forgot your temporary password? Ask the owner or an administrator to reset it.</small>
    </section>
  </main>;
}
