export function Pill({ value }: { value?: string }) {
  if (!value) return null;
  const v = String(value);
  const lower = v.toLowerCase();
  let tone = '';
  if (['urgent', 'late', 'fix', 'rejected'].includes(lower)) tone = 'urgent';
  if (['done', 'verified', 'posted', 'approved', 'ok'].includes(lower)) tone = 'ok';
  if (['review', 'working', 'doing', 'set', 'scheduled'].includes(lower)) tone = 'blue';
  if (['pending', 'follow', 'paused'].includes(lower)) tone = 'warn';
  return <span className={`pill ${tone}`}>{v}</span>;
}
