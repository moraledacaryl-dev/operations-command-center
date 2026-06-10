'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { landingPathForUser, setStoredUser } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    setError('');
    setLoading(true);
    try {
      const user = await api.login(email.trim(), password);
      setStoredUser(user);
      router.push(landingPathForUser(user));
    } catch (err: any) {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="logo big">HO</div>
        <div>
          <div className="eyebrow">Hidden Oasis</div>
          <h1>Operations</h1>
        </div>
        <label className="label">Email<input className="input" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label>
        <label className="label">Password<input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') login(); }} autoComplete="current-password" /></label>
        {error ? <div className="pill urgent">{error}</div> : null}
        <button className="btn" onClick={login} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        <small className="muted">by C.M.</small>
      </section>
    </main>
  );
}
