import Link from 'next/link';
import { Icon, IconName } from './Icon';

export type WorkspaceStat = { label: string; value: number | null; detail?: string; icon: IconName; href?: string; attention?: boolean };
export function WorkspaceStats({ items }: { items: WorkspaceStat[] }) {
  return <div className="ops-stats">{items.map(item => {
    const content = <><span className="ops-stat-label">{item.label}<Icon name={item.icon} /></span><strong>{item.value ?? '—'}</strong>{item.detail ? <span className="ops-stat-detail">{item.attention && !!item.value && <span className="ops-attention-dot" />}{item.detail}</span> : null}</>;
    return item.href ? <Link key={item.label} className="ops-stat" href={item.href}>{content}</Link> : <div key={item.label} className="ops-stat">{content}</div>;
  })}</div>;
}
