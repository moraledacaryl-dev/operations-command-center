'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { landingPathForUser, setStoredUser } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('caryl@example.com');
  const [password, setPassword] = useState('command123');
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
      setError('Login failed. Check email/password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="logo big">CC</div>
        <div>
          <div className="eyebrow">Command Center</div>
          <h1>Sign in</h1>
          <p className="muted">Personal login. Department access loads automatically.</p>
        </div>
        <label className="label">Email<input className="input" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="label">Password<input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') login(); }} /></label>
        {error ? <div className="pill urgent">{error}</div> : null}
        <button className="btn" onClick={login} disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        <small className="muted">Local starter login: caryl@example.com / command123</small>
      </section>
    </main>
  );
}
