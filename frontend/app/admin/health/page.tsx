'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getStoredUser } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import { formatPropertyDateTime } from '@/lib/property-dates';
function backupLabel(status: unknown) {
  return ({ current: 'Up to date', failed: 'Needs attention', stale: 'Overdue' } as Record<string,string>)[String(status)] || 'Not checked';
}
export default function HealthPage() {
  const [archive, setArchive] = useState<Entity | null>(null);
  const [health, setHealth] = useState<Entity | null>(null);
  const [offsite, setOffsite] = useState<Entity | null>(null);
  const [offsiteLoading, setOffsiteLoading] = useState(true);
  const [offsiteError, setOffsiteError] = useState('');
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const role = String(getStoredUser()?.role || '').toLowerCase();
  const owner = role === 'owner';
  const canArchive = owner || role === 'admin';
  useEffect(() => {
    api.health().then(setHealth).catch((err: any) => setError(err.message || 'Could not load app status.'));
    api.offsiteBackupStatus().then(setOffsite).catch(() => setOffsiteError('Could not check the extra backup copy. Refresh or ask your administrator.')).finally(() => setOffsiteLoading(false));
  }, []);
  async function runArchive() {
    if (!canArchive || archiving) return;
    setArchiving(true);
    setError('');
    setArchive(null);
    try {
      setArchive(await api.runArchive());
    } catch (err: any) {
      setError(err.message || 'Could not move finished work to History.');
    } finally {
      setArchiving(false);
    }
  }
  const archivedCount = Object.values(archive || {}).reduce<number>((total, value) => total + (typeof value === 'number' ? value : 0), 0);
  return <div className="admin-health">
    <Top title="App status" right={<div className="toolbar" style={{ margin: 0 }}>{owner ? <Link className="btn secondary" href="/admin/appearance">Appearance</Link> : null}{canArchive ? <button className="btn secondary" onClick={runArchive} disabled={archiving}>{archiving ? 'Moving finished work…' : 'Move finished work to History'}</button> : null}</div>} />
    {error ? <div role="alert" className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="health-overview">
      <section className="health-status-row">
        <h2>Recent backups</h2>
        <Pill value={backupLabel(health?.backups?.status)} />
        <p className="muted">Last backup: {health?.backups?.last_success_at ? formatPropertyDateTime(health.backups.last_success_at) : 'Not available'}</p>
        <p className="muted">{health?.backups?.status === 'current' ? 'Recent work and files have been backed up.' : health?.backups?.status === 'failed' ? 'The last backup failed. Ask your administrator to check it.' : health?.backups?.status === 'stale' ? 'A backup is overdue. Ask your administrator to check it.' : 'Backup status is not available.'}</p>
      </section>
      <section className="health-status-row" aria-busy={offsiteLoading}>
        <h2>Extra backup copy</h2>
        <Pill value={offsiteLoading ? 'Checking' : backupLabel(offsite?.status)} />
        <p className="muted">Last copy: {offsite?.last_success_at ? formatPropertyDateTime(offsite.last_success_at) : 'Not available'}</p>
        {offsiteError ? <p className="muted" role="alert">{offsiteError}</p> : <p className="muted">{offsiteLoading ? 'Checking the extra backup copy…' : offsite?.status === 'current' ? 'A recent backup is also stored separately.' : offsite?.status === 'failed' ? 'The extra copy failed. Ask your administrator to check it.' : offsite?.status === 'stale' ? 'The extra copy is overdue. Ask your administrator to check it.' : 'The extra backup copy has not been checked.'}</p>}
      </section>
      <section className="health-status-row">
        <h2>App access</h2>
        <Pill value={health?.readiness?.ok ? 'Ready' : 'Needs attention'} />
        <p className="muted">{health?.readiness?.ok ? 'The app is ready to use.' : 'Ask your administrator to check the app setup.'}</p>
      </section>
      <section className="health-status-row">
        <h2>Finished work</h2>
        <p className="muted">Move finished work to History. You can still find it there later.</p>
        {archive ? <p role="status">{archivedCount ? `Moved ${archivedCount} ${archivedCount === 1 ? 'item' : 'items'} to History.` : 'No finished work was ready to move.'}</p> : null}
      </section>
    </div>
  </div>;
}
