'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { LoadingPanel } from '@/components/LoadingPanel';
import { Pill } from '@/components/Pill';
import { Top } from '@/components/Top';
import { Icon } from '@/components/Icon';


function stamp(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value));
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Entity[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (cursor?: string | null) => {
    if (!cursor) setLoading(true);
    setError('');
    try {
      const page = await api.notifications({ limit: 30, cursor: cursor || '' });
      setItems(existing => cursor ? [...existing, ...page.items.filter((item: Entity) => !existing.some(value => value.id === item.id))] : page.items);
      setNextCursor(page.next_cursor || null);
      setUnreadCount(Number(page.unread_count || 0));
    } catch (err: any) { setError(err.message || 'Notifications could not be loaded.'); }
    finally { if (!cursor) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (busy || loading) return;
    let active = true, pending = false;
    async function refresh() {
      if (document.visibilityState !== 'visible' || pending) return;
      pending = true;
      try {
        const page = await api.notifications({ limit: 30 });
        if (active) {
          setItems(existing => [...page.items, ...existing.filter(item => !page.items.some((fresh: Entity) => fresh.id === item.id))]);
          setNextCursor(existing => existing || page.next_cursor || null);
          setUnreadCount(Number(page.unread_count || 0));
        }
      } catch { /* Preserve the inbox during a temporary connection failure. */ }
      finally { pending = false; }
    }
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [busy, loading]);

  async function read(item: Entity) {
    setBusy(true);
    try {
      if (!item.read_at) await api.readNotification(Number(item.id));
      setItems(values => values.map(value => value.id === item.id ? { ...value, read_at: new Date().toISOString() } : value));
      setUnreadCount(value => Math.max(0, value - (item.read_at ? 0 : 1)));
    } catch (err: any) { setError(err.message || 'Notification could not be updated.'); }
    finally { setBusy(false); window.dispatchEvent(new Event('notifications-changed')); }
  }

  async function readAll() {
    setBusy(true);
    try { await api.readAllNotifications(); setItems(values => values.map(value => ({ ...value, read_at: value.read_at || new Date().toISOString() }))); setUnreadCount(0); }
    catch (err: any) { setError(err.message || 'Notifications could not be updated.'); }
    finally { setBusy(false); window.dispatchEvent(new Event('notifications-changed')); }
  }

  async function dismiss(item: Entity) {
    setBusy(true);
    try { await api.dismissNotification(Number(item.id)); setItems(values => values.filter(value => value.id !== item.id)); setUnreadCount(value => Math.max(0, value - (item.read_at ? 0 : 1))); }
    catch (err: any) { setError(err.message || 'Notification could not be dismissed.'); }
    finally { setBusy(false); window.dispatchEvent(new Event('notifications-changed')); }
  }

  if (loading) return <><Top title="Notifications" /><LoadingPanel label="Loading notifications…" /></>;

  return <div className="ops-module">
    <Top title="Notifications" right={<button className="btn secondary" disabled={busy || !unreadCount} onClick={readAll}>Mark all read</button>} />
    {error ? <div className="pill urgent" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    <div className="ops-inbox-heading"><span className="ops-record-icon"><Icon name="bell" /></span><div><strong>Your inbox</strong><span>{unreadCount ? `${unreadCount} unread updates` : 'You’re up to date'}</span></div></div>
    <div className="ops-inbox">{items.map(item => <article className={`ops-notification ${!item.read_at ? 'ops-notification-unread' : ''}`} key={item.id}>
      <span className="ops-record-icon"><Icon name="bell" /></span><div className="ops-notification-body"><div className="card-line"><Pill value={item.kind || 'Update'} /><Pill value={item.priority || 'Normal'} />{!item.read_at ? <Pill value="Unread" /> : null}</div>
      <strong className="card-title">{item.title}</strong><span>{item.body || 'Open the related workspace for details.'}</span><span className="muted">{stamp(item.created_at)}</span>
      <div className="toolbar" style={{ marginBottom: 0 }}>{item.action_url ? <Link className="btn small" href={String(item.action_url)} onClick={() => void read(item)}>Open</Link> : !item.read_at ? <button className="btn small" onClick={() => void read(item)}>Mark read</button> : null}<button className="btn small secondary" disabled={busy} onClick={() => void dismiss(item)}>Dismiss</button></div>
    </div></article>)}{!items.length ? <div className="empty"><Icon name="bell" />No notifications yet.</div> : null}</div>
    {nextCursor ? <div className="load-more"><button className="btn secondary" disabled={busy} onClick={() => void load(nextCursor)}>Load older notifications</button></div> : null}
  </div>;
}
