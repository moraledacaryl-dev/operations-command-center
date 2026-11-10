'use client';

export const MARKETING_AREAS = ['Rooms', 'Pool', 'Café', 'Kitchen', 'Bar'] as const;

export function MarketingAreas({ value, onChange, label = 'Areas covered', disabled = false }: {
  value: string[]; onChange: (next: string[]) => void; label?: string; disabled?: boolean;
}) {
  return <fieldset className="platform-picker" aria-label={label} disabled={disabled}>
    <legend>{label}</legend>
    {MARKETING_AREAS.map(area => <label key={area}><input type="checkbox" value={area}
      checked={value.includes(area)} onChange={event => onChange(event.target.checked
        ? [...value, area] : value.filter(item => item !== area))} />{area}</label>)}
    <p className="muted">Select every area covered by this work.</p>
  </fieldset>;
}

export function AreaNames({ areas }: { areas?: string[] | null }) {
  return <span className="muted">Areas: {areas?.length ? areas.join(' + ') : 'Not set'}</span>;
}
