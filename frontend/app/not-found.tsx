'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getStoredUser } from '@/lib/session';

export default function NotFound() {
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => setAuthenticated(Boolean(getStoredUser())), []);
  return <main className="not-found-screen">
    <section className="not-found-card">
      <span className="logo big" aria-hidden="true">HO</span>
      <p className="eyebrow">Page not found · 404</p>
      <h1>This route is not part of Operations.</h1>
      <p className="muted">The address may be outdated, or the page may have moved. Your operational records have not been changed.</p>
      <div className="toolbar">
        {authenticated ? <Link className="btn" href="/">Return to Today</Link> : <Link className="btn" href="/login">Sign in</Link>}
        <Link className="btn secondary" href={authenticated ? '/tasks' : '/login'}>{authenticated ? 'Open my work' : 'Back to sign in'}</Link>
      </div>
    </section>
  </main>;
}
