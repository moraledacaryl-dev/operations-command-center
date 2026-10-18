export function Top({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="topbar ops-page-heading">
      <div>
        <h1>{title}</h1>
      </div>
      {right}
    </div>
  );
}
