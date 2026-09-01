export function LoadingPanel({ label = 'Loading workspace…' }: { label?: string }) {
  return <section className="panel" aria-busy="true" aria-live="polite">
    <div className="loading-state">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  </section>;
}
