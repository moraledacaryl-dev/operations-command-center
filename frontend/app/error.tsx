'use client';

import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="not-found-screen">
    <section className="not-found-card" role="alert">
      <span className="logo big" aria-hidden="true">HO</span>
      <p className="eyebrow">Operations could not open this view</p>
      <h1>Something interrupted the workspace.</h1>
      <p className="muted">Retry the view. If it continues, share reference {error.digest || 'unavailable'} with an administrator.</p>
      <button className="btn" type="button" onClick={reset}>Try again</button>
    </section>
  </main>;
}
