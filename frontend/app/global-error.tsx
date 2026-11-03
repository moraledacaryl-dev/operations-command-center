'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en-PH"><body><main className="not-found-screen"><section className="not-found-card" role="alert">
    <p className="eyebrow">Hidden Oasis Operations</p>
    <h1>The app could not open.</h1>
    <p>Please try again.</p>
    <button type="button" onClick={reset}>Try again</button>
  </section></main></body></html>;
}
