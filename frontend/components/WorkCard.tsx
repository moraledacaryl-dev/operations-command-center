import type { ReactNode } from 'react';
import { Icon, IconName } from './Icon';

/** Shared visual language for actionable work, without coupling workflow behavior. */
export function WorkCard({ title, description, icon, meta, footer, onOpen, attention = false, accent = 'sage' }: {
  title: string; description?: string; icon: IconName; meta?: ReactNode; footer?: ReactNode;
  onOpen: () => void; attention?: boolean; accent?: 'sage' | 'sand' | 'blue';
}) {
  return <button type="button" className={`ops-work-card ops-tone-${accent}${attention ? ' ops-work-attention' : ''}`} onClick={onOpen}>
    <span className="ops-work-card-top"><span className="ops-record-icon"><Icon name={icon} /></span><span className="ops-work-card-meta">{meta}</span></span>
    <strong className="ops-work-card-title">{title}</strong>
    {description ? <span className="ops-work-card-description">{description}</span> : null}
    <span className="ops-work-card-footer"><span>{footer || 'View details'}</span><Icon name="arrow" /></span>
  </button>;
}

export function SectionHeading({ title, detail, count, icon }: { title: string; detail?: string; count?: number; icon: IconName }) {
  return <div className="ops-section-heading"><span className="ops-record-icon"><Icon name={icon} /></span><div><h2>{title}</h2>{detail ? <p>{detail}</p> : null}</div>{count !== undefined ? <span className="ops-section-count">{count}</span> : null}</div>;
}
