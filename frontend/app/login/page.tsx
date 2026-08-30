'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { landingPathForUser, setStoredUser } from '@/lib/session';

function loginErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'The service is temporarily unavailable. Please try again.';
  if (error.status === 401) return 'Invalid email or password.';
  if (error.status === 403) return 'This account cannot sign in yet. Contact an administrator.';
  if (error.status === 429) return 'Too many failed sign-in attempts. Please try again later.';
  if (error.status >= 500) return 'The service is temporarily unavailable. Please try again.';
  return 'Sign-in could not be completed. Please try again.';
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const user = await api.login(email.trim(), password);
      setStoredUser(user);
      router.replace(landingPathForUser(user));
    } catch (err: unknown) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const errorId = error ? 'login-error' : undefined;
  return <main className="auth-screen">
    <section className="auth-context" aria-label="Hidden Oasis Operations introduction">
      <div className="auth-brand"><span className="logo big" aria-hidden="true">HO</span><span><strong>Hidden Oasis</strong><small>Operations command center</small></span></div>
      <div>
        <p className="eyebrow">One clear operating picture</p>
        <h1>Coordinate today.<br />Remember tomorrow.</h1>
        <p>Bring work, handovers, guest follow-ups, maintenance, projects and approvals into one accountable place.</p>
      </div>
      <div className="auth-signals" aria-hidden="true"><span>Daily command</span><span>Clear ownership</span><span>Durable history</span></div>
    </section>
    <section className="auth-form-panel" aria-labelledby="login-title">
      <div className="auth-mobile-brand"><span className="logo big" aria-hidden="true">HO</span><span><strong>Hidden Oasis</strong><small>Operations</small></span></div>
      <div><p className="eyebrow">Welcome back</p><h2 id="login-title">Sign in to Operations</h2><p className="muted">Use your personal work account.</p></div>
      <form className="form" onSubmit={event => { event.preventDefault(); void login(); }}>
        <label className="label" htmlFor="login-email">Email<input id="login-email" className="input" type="email" inputMode="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required aria-describedby={errorId} autoFocus /></label>
        <label className="label" htmlFor="login-password">Password<input id="login-password" className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required aria-describedby={errorId} /></label>
        {error ? <p id="login-error" className="auth-error" role="alert">{error}</p> : null}
        <button className="btn auth-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <small className="muted">Protected workspace · Contact an administrator if your access has changed.</small>
    </section>
  </main>;
}
