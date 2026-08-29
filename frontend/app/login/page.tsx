'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { landingPathForUser, setStoredUser } from '@/lib/session';

const styles = {
  shell: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    background: 'radial-gradient(circle at top left, #fbfaf7 0, transparent 32%), radial-gradient(circle at bottom right, #f5eee5 0, transparent 28%), #f6f6f4',
  },
  card: {
    width: 'min(420px, 100%)',
    display: 'grid',
    gap: 18,
    padding: 30,
    borderRadius: 22,
    border: '1px solid #e1e6df',
    background: 'rgba(255,255,255,.9)',
    boxShadow: '0 24px 70px rgba(26,38,30,.09)',
  },
  mark: {
    width: 48,
    height: 48,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 15,
    background: '#7a5531',
    color: '#fff',
    fontWeight: 720,
    letterSpacing: '.03em',
  },
  title: { margin: 0, fontSize: 34, letterSpacing: '-.04em', lineHeight: 1 },
  form: { display: 'grid', gap: 13 },
  label: { display: 'grid', gap: 6, fontSize: 12, fontWeight: 650, color: '#565b55' },
  input: { width: '100%', padding: '11px 12px', borderRadius: 12, border: '1px solid #d7dad4', background: '#fff' },
  button: { width: '100%', padding: '11px 12px', borderRadius: 12, border: '1px solid #111', background: '#111', color: '#fff', fontWeight: 650, cursor: 'pointer' },
  credit: { color: '#626d65', fontSize: 12 },
  error: { color: '#9a2d2d', fontSize: 13, margin: 0 },
};

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
    setError('');
    setLoading(true);
    try {
      const user = await api.login(email.trim(), password);
      setStoredUser(user);
      router.push(landingPathForUser(user));
    } catch (err: unknown) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const errorId = error ? 'login-error' : undefined;

  return (
    <main style={styles.shell}>
      <section style={styles.card} aria-labelledby="login-title">
        <div style={styles.mark} aria-hidden="true">HO</div>
        <h1 id="login-title" style={styles.title}>Operations</h1>
        <form style={styles.form} onSubmit={(e) => { e.preventDefault(); login(); }}>
          <label htmlFor="login-email" style={styles.label}>Email</label>
          <input
            id="login-email"
            style={styles.input}
            type="email"
            inputMode="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="username"
            required
            aria-describedby={errorId}
          />
          <label htmlFor="login-password" style={styles.label}>Password</label>
          <input
            id="login-password"
            style={styles.input}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            minLength={1}
            aria-describedby={errorId}
          />
          {error ? <p id="login-error" style={styles.error} role="alert">{error}</p> : null}
          <button style={styles.button} type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <small style={styles.credit}>by C.M.</small>
      </section>
    </main>
  );
}
