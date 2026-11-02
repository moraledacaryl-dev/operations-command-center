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
    if (!Number.isSafeInteger(Number(obj.notificationId)) || Number(obj.notificationId) <= 0 ||
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
      } else setMessage('No unread fictional practice notice is available. If you finished this already, your result is saved. Otherwise close and reopen the training app.');
    } catch {
      setMessage('Could not open practice notifications. Check that the training app is running and you are signed in.');
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!notice || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const updated = await findTrainingNotice(Number(notice.id));
      if (!updated) {
        setMessage('This notice is no longer available. Start another practice notice.');
      } else if (!updated.read_at || !Number.isFinite(Date.parse(String(updated.read_at)))) {
        setMessage('The notice is still unread. Open Notifications, find the title shown here, and click Mark read. Then check again.');
      } else {
        const evidence: NotificationTrainingEvidence = {
          notificationId: Number(notice.id), completedAt: new Date().toISOString(),
        };
        setCompleted(evidence);
        setMessage('Verified: this practice notice is saved as read.');
        try {
          localStorage.setItem(notificationTrainingKey(user), JSON.stringify(evidence));
          sessionStorage.removeItem(notificationTrainingKey(user) + ':pending');
          window.dispatchEvent(new Event(NOTIFICATION_TRAINING_CHANGED));
        } catch { /* Evidence remains visible for this session. */ }
      }
    } catch {
      setMessage('Could not check the notice. Make sure the training app is running and try again.');
    } finally { setBusy(false); }
  }

  return <section className="practice-record-lookup" data-testid="notification-practice" aria-label="Practice reading a notification">
    <p className="practice-eyebrow">PRACTICE · NOTIFICATIONS</p>
    <h2>Read a notice and mark it read</h2>
    <p>Use your own practice login. This changes only whether a made-up notice shows as read. It does not finish or approve a job.</p>
    {completed && <p className="practice-record-result" role="status">Previously verified: {new Date(completed.completedAt).toLocaleDateString('en-PH')}. You can repeat it if another unread practice notice remains.</p>}
    {notice ? <>
      <p><strong>Find this notice:</strong> <code data-testid="notification-practice-title">{String(notice.title)}</code></p>
      <p>1. Open <Link href="/notifications" target="_blank" rel="noopener noreferrer">Notifications in a separate tab</Link>, find this title, and click <strong>Mark read</strong>.</p>
      <p>2. Come back here and click Check read status. Do not remove the notice or use another employee&apos;s login.</p>
      <div className="practice-actions">
        <button type="button" className="practice-primary" data-testid="notification-practice-check" disabled={busy} onClick={() => void verify()}>{busy ? 'Checking notice…' : 'Check read status'}</button>
        <button type="button" className="practice-secondary" disabled={busy} onClick={() => void start()}>Choose another unread notice</button>
      </div>
    </> : <button type="button" className="practice-primary" data-testid="notification-practice-start" disabled={busy} onClick={() => void start()}>{busy ? 'Opening practice…' : 'Start notice practice'}</button>}
    {message && <p className="practice-record-result" data-testid="notification-practice-feedback" role="status">{message}</p>}
    <small>The app checks the saved notice. This is only practice on this computer; it does not approve anyone to use the live system.</small>
  </section>;
}
