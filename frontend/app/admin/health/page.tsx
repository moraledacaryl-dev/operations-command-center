'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

function MetricList({ title, data }: { title: string; data?: Entity }) {
  return (
    <section className="panel">
      <div className="section-head"><h2>{title}</h2></div>
      <div className="health-metrics">
        {Object.entries(data || {}).map(([key, value]) => (
          <div key={key}>
            <span>{key.replaceAll('_', ' ')}</span>
            <b>{String(value ?? 0)}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HealthPage() {
  const [archive, setArchive] = useState<Entity | null>(null);
  const [health, setHealth] = useState<Entity | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      setHealth(await api.health());
    } catch (err: any) {
      setError(err.message || 'Could not load health.');
    }
  }

  useEffect(() => { load(); }, []);

  async function runArchive() {
    setError('');
    try {
      setArchive(await api.runArchive());
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not run archive.');
    }
  }

  return (
    <>
      <Top eyebrow="Admin" title="Health" right={<div className="toolbar tight"><button className="btn secondary" onClick={load}>Refresh</button><button className="btn secondary" onClick={runArchive}>Run archive</button></div>} />
      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
      <div className="owner-command-grid">
        <section className="panel">
          <div className="section-head">
            <div>
              <div className="eyebrow">Readiness</div>
              <h2>{health?.readiness?.ok ? 'Ready' : 'Needs attention'}</h2>
            </div>
            <Pill value={health?.environment || 'environment'} />
          </div>
          <div className="card-line" style={{ marginTop: 12 }}>
            <Pill value={health?.readiness?.ok ? 'ready' : 'needs attention'} />
            <Pill value={health?.storage?.uploads_ready ? 'uploads ready' : 'uploads issue'} />
            <Pill value={health?.integrations?.key_configured ? 'integrations ready' : 'integration key missing'} />
          </div>
          {!!health?.readiness?.warnings?.length && (
            <div style={{ marginTop: 12 }}>
              {health.readiness.warnings.map((warning: string) => <div className="pill warn" key={warning} style={{ marginBottom: 8 }}>{warning}</div>)}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="section-head"><h2>Integrations</h2><Pill value={`${health?.integrations?.pending_review || 0} pending`} /></div>
          <div className="detail-row"><span>last event</span><span>{health?.integrations?.last_event || 'none'}</span></div>
          <div className="detail-row"><span>last event at</span><span>{health?.integrations?.last_event_at ? String(health.integrations.last_event_at).slice(0, 16).replace('T', ' ') : 'never'}</span></div>
          <div className="detail-row"><span>uploads</span><span>{health?.storage?.upload_files ?? 0} files</span></div>
        </section>
      </div>
      <div className="grid cols-2">
        <MetricList title="Open work" data={health?.operations?.open} />
        <MetricList title="Setup" data={health?.operations?.active} />
        <section className="panel">
          <h2>Archive</h2>
          {archive ? <div className="card-line" style={{ marginTop: 12 }}>{Object.entries(archive).map(([k, v]) => <Pill key={k} value={`${k}: ${v}`} />)}</div> : <p className="muted">Move completed work into History after the configured holding period.</p>}
        </section>
        <section className="panel">
          <h2>Boundaries</h2>
          <p className="muted">Command Center owns decisions, follow-up, approvals, and memory. Accounting owns money. POS owns orders. Staff App owns staff records.</p>
        </section>
      </div>
    </>
  );
}
