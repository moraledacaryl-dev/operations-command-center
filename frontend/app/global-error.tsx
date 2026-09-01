'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en-PH"><body><main className="not-found-screen"><section className="not-found-card" role="alert">
    <p className="eyebrow">Hidden Oasis Operations</p>
    <h1>The application shell could not load.</h1>
    <p>Retry now. No operational records were changed by this display error.</p>
    <button type="button" onClick={reset}>Try again</button>
  </section></main></body></html>;
}
