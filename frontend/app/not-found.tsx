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
      <p className="eyebrow">Page not found</p>
      <h1>This page could not be found.</h1>
      <p className="muted">The link may be old. Return to Today or sign in.</p>
      <div className="toolbar">
        {authenticated ? <Link className="btn" href="/">Return to Today</Link> : <Link className="btn" href="/login">Sign in</Link>}
        <Link className="btn secondary" href={authenticated ? '/tasks' : '/login'}>{authenticated ? 'Open my work' : 'Back to sign in'}</Link>
      </div>
    </section>
  </main>;
}
