'use client';
import { useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
export default function HealthPage() {
  const [archive, setArchive] = useState<Entity | null>(null);
  const [error, setError] = useState('');
  async function runArchive() {
    setError('');
    try {
      setArchive(await api.runArchive());
    } catch (err: any) {
      setError(err.message || 'Could not run archive.');
    }
  }
  return <>
    <Top eyebrow="Admin" title="Health" right={<button className="btn secondary" onClick={runArchive}>Run archive</button>} />
    {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="grid cols-2">
      <section className="panel"><h2>App fit</h2><div className="card-line"><Pill value="Ops-ready starter" /><span className="muted">Local command center with authenticated API and manager review queues.</span></div></section>
      <section className="panel"><h2>Archive</h2>{archive ? <div className="card-line">{Object.entries(archive).map(([k, v]) => <Pill key={k} value={`${k}: ${v}`} />)}</div> : <p className="muted">Move completed work into History after the configured holding period.</p>}</section>
      <section className="panel"><h2>Boundaries</h2><p className="muted">Command Center owns review, planning, approvals, and memory. Accounting owns PR/PO/money. POS owns orders/payments. Staff App captures work later.</p></section>
    </div>
  </>;
}
