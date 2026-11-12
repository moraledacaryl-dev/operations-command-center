'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { API_BASE, Entity } from '@/lib/api';
import { COURSE_STORAGE_PREFIX } from '@/lib/training-course';
import { TrainingSpotlight } from '@/components/TrainingSpotlight';

export const ROOM_ARRIVAL_FINISHED = 'ho-training-room-arrivals-finished';
const PREFIX = 'ho-ops-room-arrivals-practice-v1:';
type Stay = { id: number; checked_in_by_id: number; checked_out_by_id: number | null; checked_out_at: string | null };
type Room = { room_area_id: number; room_name: string; guest_stay: Stay | null };
type Progress = {
  attempt: 0 | 1; stage: 'intro' | 'arrival' | 'departure';
  roomId?: number; baselineId?: number; stayId?: number;
  first?: { roomId: number; stayId: number }; hints: number;
};

function readProgress(raw: string | null): Progress {
  try {
    const p = JSON.parse(raw || 'null');
    if (!p || ![0, 1].includes(p.attempt) || !['intro', 'arrival', 'departure'].includes(p.stage)
      || !Number.isInteger(p.hints) || p.hints < 0
      || (p.stage !== 'intro' && (!Number.isInteger(p.roomId) || p.roomId < 1 || !Number.isInteger(p.baselineId) || p.baselineId < 0))
      || (p.stage === 'departure' && (!Number.isInteger(p.stayId) || p.stayId <= p.baselineId))
      || (p.attempt === 1 && (!Number.isInteger(p.first?.roomId) || !Number.isInteger(p.first?.stayId)))) throw Error();
    return p;
  } catch { return { attempt: 0, stage: 'intro', hints: 0 }; }
}

/** Training only. The learner uses the real Room cleaning buttons. This coach
 * only reads the authenticated API; it never creates, changes or resets a stay.
 */
export function RoomArrivalPractice({ user, path }: { user: Entity; path: string }) {
  const router = useRouter();
  const identity = String(user.id || '');
  const key = PREFIX + identity;
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState<Progress>({ attempt: 0, stage: 'intro', hints: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [checkTarget, setCheckTarget] = useState<HTMLElement | null>(null);
  // Separate rooms keep the AM and PM practice accounts from changing each
  // other's exercise. All guests and room work in this app are fictional.
  const rooms = String(user.email || '').startsWith('reception-pm@')
    ? ['Grandeur', 'Skyroom'] : ['Cafe Suite', 'Crown'];
  const roomName = rooms[progress.attempt];

  const refresh = useCallback(() => {
    try {
      const course = JSON.parse(localStorage.getItem(COURSE_STORAGE_PREFIX + identity) || 'null');
      const eligible = user.role === 'staff' && Array.isArray(user.departments)
        && user.departments.some((d: Entity) => String(d.name || '').toLowerCase() === 'front desk');
      const ready = eligible && course?.lessonId === 'room-arrivals' && course?.stage === 'independent';
      setActive(Boolean(ready));
      if (ready) setProgress(readProgress(localStorage.getItem(key)));
    } catch { setActive(false); }
  }, [identity, key, user]);

  useEffect(() => {
    refresh();
    window.addEventListener('ho-training-course-changed', refresh);
    return () => window.removeEventListener('ho-training-course-changed', refresh);
  }, [refresh, path]);

  useEffect(() => {
    if (!active || progress.stage === 'intro' || path !== '/housekeeping') { setCheckTarget(null); return; }
    const locate = () => setCheckTarget(document.querySelector<HTMLElement>('[data-room-practice-check="' + progress.roomId + '"]'));
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    const onSaved = (event: Event) => {
      if ((event as CustomEvent).detail?.roomId === progress.roomId) {
        setShowGuide(false); setMessage('Saved on the room. Choose Check saved work.');
      }
    };
    window.addEventListener('ho-room-status-saved', onSaved);
    locate();
    return () => { observer.disconnect(); window.removeEventListener('ho-room-status-saved', onSaved); };
  }, [active, progress.roomId, progress.stage, path]);

  useEffect(() => {
    if (!active || !showGuide || progress.stage === 'intro') return;
    const hideAfterClick = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      const card = button?.closest('[data-testid="cleaning-room-' + progress.roomId + '"]');
      const label = progress.stage === 'arrival' ? 'Record check-in' : 'Record checkout';
      if (card && button?.textContent?.trim() === label) setShowGuide(false);
    };
    document.addEventListener('click', hideAfterClick, true);
    return () => document.removeEventListener('click', hideAfterClick, true);
  }, [active, showGuide, progress.stage, progress.roomId]);

  async function board(): Promise<Room[]> {
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const response = await fetch(API_BASE + '/housekeeping/turnovers?service_date=' + date, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw Error('Could not read the saved room status. Check the practice app and try again.');
    const data = await response.json();
    if (data.date !== date || !Array.isArray(data.rooms)) throw Error('The room list could not be checked. Refresh the page and try again.');
    return data.rooms;
  }

  function save(next: Progress) {
    localStorage.setItem(key, JSON.stringify(next));
    setProgress(next);
  }

  async function begin() {
    setBusy(true); setMessage('');
    try {
      const room = (await board()).find(r => r.room_name === roomName);
      if (!room) throw Error('The practice room is missing. Ask your trainer to check the sample rooms.');
      if (room.guest_stay && !room.guest_stay.checked_out_at) throw Error('A guest is already recorded in this practice room. Ask your trainer to check it before starting.');
      save({ ...progress, stage: 'arrival', roomId: room.room_area_id, baselineId: room.guest_stay?.id || 0, stayId: undefined });
      setShowGuide(progress.attempt === 0);
      router.push('/housekeeping');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Progress could not be saved. Ask your trainer for help.'); }
    finally { setBusy(false); }
  }

  async function checkSavedWork() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      if (path !== '/housekeeping') throw Error('Open Room cleaning first, then check your saved work.');
      const rows = await board();
      const room = rows.find(r => r.room_area_id === progress.roomId && r.room_name === roomName);
      const stay = room?.guest_stay;
      if (progress.stage === 'arrival') {
        if (!stay || stay.id <= (progress.baselineId || 0) || stay.checked_in_by_id !== Number(user.id)) {
          throw Error('Your new check-in has not been found in ' + roomName + '. Use Record check-in on that room, then check again.');
        }
        if (stay.checked_out_at) throw Error('This guest has already checked out. Use Start this room again to make a fresh attempt.');
        save({ ...progress, stage: 'departure', stayId: stay.id });
        setShowGuide(progress.attempt === 0);
        setMessage('Your check-in is saved. Now the practice guest has returned the key and is leaving. Record checkout.');
      } else {
        if (!stay || stay.id !== progress.stayId || stay.checked_in_by_id !== Number(user.id)
          || !stay.checked_out_at || stay.checked_out_by_id !== Number(user.id)) {
          throw Error('Your checkout has not been found for this practice guest. Use Record checkout in ' + roomName + ', then check again.');
        }
        if (progress.attempt === 0) {
          save({ attempt: 1, stage: 'intro', first: { roomId: room!.room_area_id, stayId: stay.id }, hints: progress.hints });
          setShowGuide(false);
          setMessage('Both records are saved. Try the next room on your own.');
        } else {
          const first = rows.find(r => r.room_area_id === progress.first?.roomId)?.guest_stay;
          if (!first || first.id !== progress.first?.stayId || !first.checked_out_at
            || first.checked_in_by_id !== Number(user.id) || first.checked_out_by_id !== Number(user.id)) {
            throw Error('The first practice room has changed. Ask your trainer to check both attempts before continuing.');
          }
          localStorage.setItem(PREFIX + 'evidence:' + identity, JSON.stringify({
            checkedAt: new Date().toISOString(), stays: [first.id, stay.id], hints: progress.hints,
          }));
          localStorage.removeItem(key);
          setActive(false);
          window.dispatchEvent(new CustomEvent(ROOM_ARRIVAL_FINISHED, { detail: { hints: progress.hints } }));
        }
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not check this attempt. Try again or ask your trainer.'); }
    finally { setBusy(false); }
  }

  async function restartRoom() {
    setBusy(true); setMessage('');
    try {
      const room = (await board()).find(r => r.room_area_id === progress.roomId);
      if (room?.guest_stay && !room.guest_stay.checked_out_at) throw Error('This room still has a recorded check-in. Finish its checkout or ask your trainer before restarting.');
      save({ attempt: progress.attempt, stage: 'intro', hints: progress.hints, first: progress.first });
      setShowGuide(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not restart this room.'); }
    finally { setBusy(false); }
  }

  if (!active || process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return null;
  return <>
    <section className="room-mission" data-testid="room-arrival-practice" aria-label="Front Desk arrival practice">
      <div className="room-mission-top"><span>FRONT DESK · PRACTICE ONLY</span><strong>{progress.attempt === 0 ? 'With a guide' : 'Your turn'}</strong></div>
      <h2>{progress.stage === 'intro' ? 'A practice guest arrives in ' + roomName
        : progress.stage === 'arrival' ? 'Record check-in in ' + roomName : 'Record checkout in ' + roomName}</h2>
      <p>{progress.stage === 'intro' ? 'Record the arrival and departure of a made-up guest. Use the room buttons yourself; this guide checks what was saved.'
        : progress.stage === 'arrival' ? 'The guest has arrived. Find ' + roomName + ' on Room cleaning and record check-in.'
        : 'The guest has returned the key and is leaving. Record checkout for the same room. Checkout does not mean the room is clean.'}</p>
      {progress.stage === 'intro' ? <button type="button" className="room-mission-primary" disabled={busy} onClick={() => void begin()}>
        {progress.attempt === 0 ? 'Start with a guide' : 'Try the next room'}</button> : <>
        {!checkTarget && <button type="button" className="room-mission-primary" disabled={busy} onClick={() => void checkSavedWork()}>{busy ? 'Checking…' : 'Check saved work'}</button>}
        {path !== '/housekeeping' && <button type="button" className="btn secondary" onClick={() => router.push('/housekeeping')}>Open Room cleaning</button>}
        <details><summary>Need help?</summary><p>Choose today, type {roomName} in Find room, then use {progress.stage === 'arrival' ? 'Record check-in' : 'Record checkout'} on that room. The app asks you to confirm before saving.</p></details>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => {
          if (!showGuide) { try { save({ ...progress, hints: progress.hints + 1 }); } catch { setMessage('Help use could not be saved. Ask your trainer for help.'); return; } }
          setShowGuide(value => !value);
        }}>{showGuide ? 'Hide arrow' : 'Show me where'}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void restartRoom()}>Start this room again</button>
      </>}
      {message && !checkTarget && <p role="status" className="room-mission-feedback">{message}</p>}
      <small>Two rooms, with saved check-in and checkout in each. These records stay in this practice app.</small>
    </section>
    {checkTarget && progress.stage !== 'intro' && createPortal(<aside className="hk-practice-check" aria-label="Check this practice room">
      <strong>Practice: {progress.stage === 'arrival' ? 'record check-in' : 'record checkout'}</strong>
      <button type="button" className="room-mission-primary" disabled={busy} onClick={() => void checkSavedWork()}>{busy ? 'Checking…' : 'Check saved work'}</button>
      {message && <p role="status">{message}</p>}
    </aside>, checkTarget)}
    {showGuide && progress.stage !== 'intro' && path === '/housekeeping' && <TrainingSpotlight
      title={progress.stage === 'arrival' ? 'Record the arrival' : 'Record the departure'}
      description={'Use the button on ' + roomName + '. Choose Check saved work afterwards.'} stepLabel="PRACTICE ROOM"
      targets={[{ selector: `[data-testid="cleaning-room-${progress.roomId}"] button`, containsText: progress.stage === 'arrival' ? 'Record check-in' : 'Record checkout' }]}
      onClose={() => setShowGuide(false)} />}
  </>;
}
