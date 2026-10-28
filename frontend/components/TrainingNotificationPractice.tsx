'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';

export const NOTIFICATION_TRAINING_CHANGED = 'ho-ops-training-notification-read';
const TRAINING_TITLE = '[TRAINING] Daily notice practice';

export function notificationTrainingKey(user: Entity): string {
  return 'ho-ops-notification-read-v1:' + String(user.id || user.email);
}

export type NotificationTrainingEvidence = { notificationId: number; completedAt: string };

export function readNotificationTraining(user: Entity): NotificationTrainingEvidence | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(notificationTrainingKey(user));
    if (!raw) return null;
    const item: unknown = JSON.parse(raw);
    if (!item || typeof item !== 'object') return null;
    const obj = item as Record<string, unknown>;
    if (!Number.isSafeInteger(obj.notificationId) || Number(obj.notificationId) <= 0 ||
      typeof obj.completedAt !== 'string' || !Number.isFinite(Date.parse(obj.completedAt))) return null;
    return { notificationId: Number(obj.notificationId), completedAt: obj.completedAt };
  } catch { return null; }
}

async function findTrainingNotice(id?: number): Promise<Entity | null> {
  let cursor = '';
  // Personal notifications are paginated; a busy account may have more than
  // 100 newer notifications before the seeded fictional one.
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const result = await api.notifications({ limit: 100, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result.items)) return null;
    const match = result.items.find((row: Entity) =>
      row.kind === 'training_practice_read' &&
      typeof row.title === 'string' && row.title.startsWith(TRAINING_TITLE) &&
      Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0 &&
      !row.dismissed_at && (id ? Number(row.id) === id : !row.read_at));
    if (match) return match;
    if (!result.next_cursor || result.next_cursor === cursor) break;
    cursor = result.next_cursor;
  }
  return null;
}

/** The employee must click Mark read in the actual Notifications module. */
export function TrainingNotificationPractice({ user }: { user: Entity }) {
  const [notice, setNotice] = useState<Entity | null>(null);
  const [completed, setCompleted] = useState<NotificationTrainingEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setCompleted(readNotificationTraining(user));
    setNotice(null);
    setMessage('');
    try {
      const id = Number(sessionStorage.getItem(notificationTrainingKey(user) + ':pending'));
      if (Number.isSafeInteger(id) && id > 0) {
        void findTrainingNotice(id).then(saved => {
          if (saved) setNotice(saved);
          else sessionStorage.removeItem(notificationTrainingKey(user) + ':pending');
        }).catch(() => { /* The next Start button retries the local service. */ });
      }
    } catch { /* Session storage may be unavailable. */ }
  }, [user]);

  if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return null;

  async function start() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const selected = await findTrainingNotice();
      setNotice(selected);
      if (selected) {
        try {
          sessionStorage.setItem(notificationTrainingKey(user) + ':pending', String(selected.id));
        } catch { /* The lesson can continue without a bookmark. */ }
      } else setMessage('No unread fictional practice notice is available. If you already marked both read, your result remains saved. Otherwise reopen this training launcher to check the local sample data.');
    } catch {
      setMessage('Could not reach your fictional notification inbox. Check the local training service and your login.');
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!notice || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const updated = await findTrainingNotice(Number(notice.id));
      if (!updated) {
        setMessage('The selected practice notice could not be retrieved. It may have been dismissed; start a new practice notice.');
      } else if (!updated.read_at || !Number.isFinite(Date.parse(String(updated.read_at)))) {
        setMessage('The saved notice is still unread. Open Notifications, find the exact title, and click Mark read before checking again.');
      } else {
        const evidence: NotificationTrainingEvidence = {
          notificationId: Number(notice.id), completedAt: new Date().toISOString(),
        };
        setCompleted(evidence);
        setMessage('Verified: your fictional notification is marked read in the actual local Operations database.');
        try {
          localStorage.setItem(notificationTrainingKey(user), JSON.stringify(evidence));
          sessionStorage.removeItem(notificationTrainingKey(user) + ':pending');
          window.dispatchEvent(new Event(NOTIFICATION_TRAINING_CHANGED));
        } catch { /* Evidence remains visible for this session. */ }
      }
    } catch {
      setMessage('Unable to verify the saved notification. Check the local service and try again.');
    } finally { setBusy(false); }
  }

  return <section className="practice-record-lookup" data-testid="notification-practice" aria-label="Notification acknowledgement practice">
    <p className="practice-eyebrow">STAFF-SAFE SAVED ACTION</p>
    <h2>Read and acknowledge a notification</h2>
    <p>Use your own fictional staff account. This exercise changes only the <strong>read status</strong> of a fictional notice, not a work item or its approval.</p>
    {completed && <p className="practice-record-result" role="status">Previously verified: {new Date(completed.completedAt).toLocaleDateString('en-PH')}. You can repeat it if another unread practice notice remains.</p>}
    {notice ? <>
      <p><strong>Find this notice:</strong> <code data-testid="notification-practice-title">{String(notice.title)}</code></p>
      <p>1. Open <Link href="/notifications" target="_blank" rel="noopener noreferrer">Notifications in a separate tab</Link>, find the exact notice, read it, and click <strong>Mark read</strong>.</p>
      <p>2. Return here and check the saved read status. Do not dismiss the notice or use another employee's login.</p>
      <div className="practice-actions">
        <button type="button" className="practice-primary" data-testid="notification-practice-check" disabled={busy} onClick={() => void verify()}>{busy ? 'Checking saved notice…' : 'Verify saved read status'}</button>
        <button type="button" className="practice-secondary" disabled={busy} onClick={() => void start()}>Choose another unread notice</button>
      </div>
    </> : <button type="button" className="practice-primary" data-testid="notification-practice-start" disabled={busy} onClick={() => void start()}>{busy ? 'Opening practice…' : 'Start notification practice'}</button>}
    {message && <p className="practice-record-result" data-testid="notification-practice-feedback" role="status">{message}</p>}
    <small>Database read-back confirms the notice's saved read status, but device-local completion is not a signed certification or proof of who clicked the button. Production is never contacted.</small>
  </section>;
}
