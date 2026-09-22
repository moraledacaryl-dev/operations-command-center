'use client';

import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
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

  return <>
    <Top eyebrow="Personal workspace" title="My work" />
    <p className="muted" style={{ marginTop: -12, marginBottom: 18 }}>Tasks assigned to you across every department you can access.</p>
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {!payload && !error ? <div className="empty">Loading your work…</div> : null}

    <div className="grid">
      {sections.map(([key, label]) => {
        const items: Entity[] = groups[key] || [];
        return (
          <section className={`panel my-work-section my-work-${key}`} key={key}>
            <div className="topbar">
              <div><div className="eyebrow">{label}</div><h2>{items.length}</h2></div>
            </div>
            {items.length ? <div className="my-work-items">
              {items.map(item => (
                <button className="card my-work-item" type="button" key={item.id} onClick={() => setSelected(item)}>
                  <span className="card-title">{item.title}</span>
                  <span className="card-line"><Pill value={item.status} /><Pill value={item.priority} /></span>
                  <span className="muted">{item.department_name || 'No department'} · {dueLabel(item.due_date)}</span>
                </button>
              ))}
            </div> : <div className="empty">Nothing here</div>}
          </section>
        );
      })}
    </div>

    <Drawer item={selected} onClose={() => setSelected(null)} />
  </>;
}
