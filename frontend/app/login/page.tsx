'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
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
  credit: { color: '#7b8179', fontSize: 12 },
  error: { color: '#b42318', fontSize: 13, margin: 0 },
};

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
    <main style={styles.shell}>
      <section style={styles.card}>
        <div style={styles.mark}>HO</div>
        <h1 style={styles.title}>Operations</h1>
        <form style={styles.form} onSubmit={(e) => { e.preventDefault(); login(); }}>
          <label style={styles.label}>Email<input style={styles.input} value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label>
          <label style={styles.label}>Password<input style={styles.input} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
          {error ? <p style={styles.error}>{error}</p> : null}
          <button style={styles.button} type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <small style={styles.credit}>by C.M.</small>
      </section>
    </main>
  );
}
