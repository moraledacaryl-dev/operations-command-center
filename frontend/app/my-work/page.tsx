'use client';

import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { SectionHeading } from '@/components/WorkCard';
import { Icon } from '@/components/Icon';
import { WorkspaceStats } from '@/components/WorkspaceStats';

import { Pill } from '@/components/Pill';
import { Drawer } from '@/components/Drawer';

const sections = [
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['upcoming', 'Upcoming'],
  ['waiting', 'Waiting or review'],
  ['recently_completed', 'Recently completed'],
] as const;

function dueLabel(value?: string) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default function MyWorkPage() {
  const [payload, setPayload] = useState<Entity | null>(null);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.list('my-work')
      .then(result => setPayload(result as unknown as Entity))
      .catch((err: Error) => setError(err.message || 'My work could not be loaded.'));
  }, []);

  const groups = payload?.groups || {};

  return <div className="ops-module">
    <Top title="My work" />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {!payload && !error ? <div className="empty">Loading your work…</div> : null}

    <WorkspaceStats items={[
      { label: 'Past due', value: payload ? (groups.overdue || []).length : null, icon: 'clock', attention: true },
      { label: 'Due today', value: payload ? (groups.today || []).length : null, icon: 'sun' },
      { label: 'Waiting', value: payload ? (groups.waiting || []).length : null, icon: 'review' },
    ]} />
    {payload ? <div className="ops-agenda">
      {sections.map(([key, label]) => {
        const items: Entity[] = groups[key] || [];
        return (
          <section className={`ops-agenda-section ops-agenda-${key}`} key={key}>
            <SectionHeading title={label} icon={key === 'overdue' ? 'clock' : key === 'today' ? 'sun' : key === 'recently_completed' ? 'check' : 'tasks'} count={items.length} />
            {items.length ? <div className="ops-agenda-items">
              {items.map(item => (
                <button className="ops-agenda-item" type="button" key={item.id} onClick={() => setSelected(item)}>
                  <span className="ops-task-check"><Icon name={item.status === 'Done' ? 'check' : 'tasks'} /></span><span className="ops-agenda-item-copy"><strong>{item.title}</strong>
                  <span className="card-line"><Pill value={item.priority} /></span>
                  <span className="muted">{item.department_name || 'No department'} · {dueLabel(item.due_date)}</span></span><Icon className="ops-row-arrow" name="arrow" />
                </button>
              ))}
            </div> : <div className="ops-agenda-empty"><Icon name="check" />Nothing scheduled here.</div>}
          </section>
        );
      })}
    </div> : null}

    <Drawer item={selected} onClose={() => setSelected(null)} />
  </div>;
}
