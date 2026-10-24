'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { formatPropertyDateTime } from '@/lib/property-dates';
export default function HealthPage() {
  const [archive, setArchive] = useState<Entity | null>(null);
  const [health, setHealth] = useState<Entity | null>(null);
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const role = String(getStoredUser()?.role || '').toLowerCase();
  const owner = role === 'owner';
  const canArchive = owner || role === 'admin';
  useEffect(() => {
    api.health().then(setHealth).catch((err: any) => setError(err.message || 'Could not load health.'));
  }, []);
  async function runArchive() {
    if (!canArchive || archiving) return;
    setArchiving(true);
    setError('');
    setArchive(null);
    try {
      setArchive(await api.runArchive());
    } catch (err: any) {
      setError(err.message || 'Could not run archive.');
    } finally {
      setArchiving(false);
    }
  }
  return <div className="admin-health">
    <Top title="Health" right={<div className="toolbar" style={{ margin: 0 }}>{owner ? <Link className="btn secondary" href="/admin/appearance">Appearance</Link> : null}{canArchive ? <button className="btn secondary" onClick={runArchive} disabled={archiving}>{archiving ? 'Archiving…' : 'Run archive'}</button> : null}</div>} />
    {error ? <div role="alert" className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="health-overview">
      <section className="health-status-row"><div className="health-status-label">Recovery</div><h2>Backups</h2><div className="card-line"><Pill value={health?.backups?.status || 'unknown'} /></div><p className="muted">Last verified snapshot: {health?.backups?.last_success_at ? formatPropertyDateTime(health.backups.last_success_at) : 'Not available'}</p><p className="muted">{health?.backups?.status === 'current' ? 'Hourly database and uploads backups are current.' : health?.backups?.status === 'failed' ? 'The last backup attempt failed. Ask the system operator to check the backup service and disk capacity.' : health?.backups?.status === 'stale' ? 'The hourly backup is overdue. Ask the system operator to check the hourly backup schedule.' : 'Backup status has not been verified. Ask the system operator to check the backup schedule.'}</p><p className="muted">Offsite copies and recovery exercises are checked separately.</p></section>
      <section className="health-status-row">
        <div className="health-status-label">Authentication</div><h2>Readiness</h2>
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
      <section className="health-status-row"><div className="health-status-label">Lifecycle</div><h2>Archive</h2><p className="muted">Owner/Admin can move eligible finished work from every department into History. Records remain available there.</p>{archive ? <div className="card-line" role="status">{Object.entries(archive).map(([key, value]) => <Pill key={key} value={`${key}: ${value}`} />)}</div> : <p className="muted">Completed work is kept active until its holding period ends.</p>}</section>
      <section className="health-boundaries"><div className="health-status-label">System ownership</div><h2>Boundaries</h2><div className="health-boundary-grid"><span><b>Command Center</b>Review, planning, approvals, operational memory</span><span><b>Accounting</b>PR, PO and money</span><span><b>POS</b>Orders and payments</span><span><b>Staff App</b>Work capture</span></div></section>
    </div>
  </div>;
}
