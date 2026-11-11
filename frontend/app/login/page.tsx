'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { landingPathForUser, setStoredUser } from '@/lib/session';

function loginErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return 'The app is unavailable. Please try again in a moment.';
  if (error.status === 401) return 'Invalid username or password.';
  if (error.status === 403) return 'This account cannot sign in yet. Contact an administrator.';
  if (error.status === 429) return 'Too many failed sign-in attempts. Please try again later.';
  if (error.status >= 500) return 'The app is unavailable. Please try again in a moment.';
  return 'Sign-in could not be completed. Please try again.';
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
      // In the desktop training build, begin on the *actual* fictional Operations dashboard.
      // The in-context training coach introduces controls on their real pages.
      router.replace(user.must_change_password ? '/change-password' : process.env.NEXT_PUBLIC_TRAINING_MODE === 'true' ? '/' : landingPathForUser(user));
    } catch (err: unknown) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const errorId = error ? 'login-error' : undefined;
  return <main className="auth-screen">
    <section className="auth-context" aria-label="Hidden Oasis Operations introduction">
      <div className="auth-brand"><span className="logo big" aria-hidden="true">HO</span><span><strong>Hidden Oasis</strong><small>Operations</small></span></div>
      <div>
        <h1>Operations</h1>
      </div>
    </section>
    <section className="auth-form-panel" aria-labelledby="login-title">
      <div className="auth-mobile-brand"><span className="logo big" aria-hidden="true">HO</span><span><strong>Hidden Oasis</strong><small>Operations</small></span></div>
      <div><h2 id="login-title">Sign in to Operations</h2>{process.env.NEXT_PUBLIC_TRAINING_MODE === 'true' ? <p className="pill ok" role="status">TRAINING ONLY · Fictional employees and guests · Not the real Operations system</p> : null}</div>
      <form className="form" onSubmit={event => { event.preventDefault(); void login(); }}>
        {searchParams.get('password') === 'changed' ? <p className="pill ok" role="status">Password updated. Sign in with your new password.</p> : null}
        <label className="label" htmlFor="login-email">Username or email<input id="login-email" className="input" type="text" inputMode="text" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required aria-describedby={errorId} autoFocus /></label>
        <label className="label" htmlFor="login-password">Password<input id="login-password" className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required aria-describedby={errorId} /></label>
        {error ? <p id="login-error" className="auth-error" role="alert">{error}</p> : null}
        <button className="btn auth-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <small className="muted">Forgot your password? Ask the owner or an administrator to reset it.</small>
    </section>
  </main>;
}
