'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
export default function HealthPage() {
  const [archive, setArchive] = useState<Entity | null>(null);
  const [health, setHealth] = useState<Entity | null>(null);
  const [error, setError] = useState('');
  const owner = String(getStoredUser()?.role || '').toLowerCase() === 'owner';
  useEffect(() => {
    api.health().then(setHealth).catch((err: any) => setError(err.message || 'Could not load health.'));
  }, []);
  async function runArchive() {
    setError('');
    try {
      setArchive(await api.runArchive());
    } catch (err: any) {
      setError(err.message || 'Could not run archive.');
    }
  }
  return <div className="admin-health">
    <Top eyebrow="Admin" title="Health" right={<div className="toolbar" style={{ margin: 0 }}>{owner ? <Link className="btn secondary" href="/admin/appearance">Appearance</Link> : null}<button className="btn secondary" onClick={runArchive}>Run archive</button></div>} />
    {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="grid cols-2">
      <section className="panel">
        <h2>Auth readiness</h2>
        <div className="card-line">
          <Pill value={health?.readiness?.ok ? 'ready' : 'needs attention'} />
          <span className="muted">Per-user password auth with startup readiness checks.</span>
        </div>
        {!!health?.readiness?.warnings?.length && (
          <div style={{ marginTop: 12 }}>
            {health.readiness.warnings.map((warning: string) => <div className="pill warn" key={warning} style={{ marginBottom: 8 }}>{warning}</div>)}
          </div>
        )}
      </section>
      <section className="panel"><h2>Archive</h2>{archive ? <div className="card-line">{Object.entries(archive).map(([key, value]) => <Pill key={key} value={`${key}: ${value}`} />)}</div> : <p className="muted">Move completed work into History after the configured holding period.</p>}</section>
      <section className="panel"><h2>Boundaries</h2><p className="muted">Command Center owns review, planning, approvals, and memory. Accounting owns PR/PO/money. POS owns orders/payments. Staff App captures work later.</p></section>
    </div>
  </div>;
}
