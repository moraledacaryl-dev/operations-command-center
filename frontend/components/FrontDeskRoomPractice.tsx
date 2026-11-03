'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Entity } from '@/lib/api';
import { COURSE_STORAGE_PREFIX } from '@/lib/training-course';
import { TrainingSpotlight } from '@/components/TrainingSpotlight';
import { FIRST_ROOM, SECOND_ROOM, ROOM_MISSION_PREFIX, ROOM_PRACTICE_EVENT,
  ROOM_PRACTICE_FINISHED, findPracticeIssue, readRoomMission,
} from '@/lib/training-room-mission';
import type { RoomMissionProgress, RoomMissionStage, RoomPracticeAction } from '@/lib/training-room-mission';

/** The employee works in actual Rooms and room-detail pages, never a fake form.
 *  A navigation click alone cannot pass: real authenticated room-memory data
 *  must contain the expected fictional issue, and the employee must report its
 *  saved status. No record is ever written or modified by this coach.
 */
export function FrontDeskRoomPractice({ user, path }: { user: Entity; path: string }) {
  const router = useRouter();
  const identity = String(user.id || user.email || '');
  const key = ROOM_MISSION_PREFIX + identity;
  const courseKey = COURSE_STORAGE_PREFIX + identity;
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState<RoomMissionProgress>({ stage: 'intro' });
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const [checking, setChecking] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const stage = progress.stage;

  const refresh = useCallback(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(courseKey) || 'null');
      const onCourse = saved?.lessonId === 'staff-rooms' && saved?.stage === 'room-practice';
      const frontDesk = user.role === 'staff' &&
        Array.isArray(user.departments) &&
        user.departments.some((dept: Entity) => String(dept.name || '').toLowerCase() === 'front desk');
      setActive(Boolean(onCourse && frontDesk));
      if (onCourse && frontDesk) setProgress(readRoomMission(localStorage.getItem(key)));
    } catch { setActive(false); }
  }, [courseKey, key, user]);

  useEffect(() => {
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('ho-training-course-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ho-training-course-changed', refresh);
    };
  }, [refresh, path]);

  const moveTo = useCallback((next: RoomMissionProgress) => {
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { setFeedback('Progress could not be saved. Please ask your trainer for help before closing the app.'); }
    setProgress(next);
    setAnswer('');
    setShowHelp(false);
  }, [key]);

  const verifyOpenedRoom = useCallback(async (id: number, expected: typeof FIRST_ROOM | typeof SECOND_ROOM) => {
    const memory = await api.roomMemory(id);
    return findPracticeIssue(memory, expected.name, expected.title);
  }, []);

  useEffect(() => {
    if (!active) return;
    const handle = (event: Event) => {
      const action = (event as CustomEvent<RoomPracticeAction>).detail;
      if (!action || typeof action !== 'object') return;
      if (stage === 'filter' && action.kind === 'filter' && action.value === 'room') {
        moveTo({ stage: 'search' }); setFeedback('Correct. Now type Solace in the search box.');
      } else if (stage === 'search' && action.kind === 'search' &&
                 action.value.trim().toLowerCase() === 'solace') {
        moveTo({ stage: 'open' }); setFeedback('Good. Open the room named Solace.');
      } else if (stage === 'solo-search' && action.kind === 'search' &&
                 action.value.trim().toLowerCase() === 'perch 1') {
        moveTo({ ...progress, stage: 'solo-open' }); setFeedback('Now open Perch 1. No arrows this time.');
      } else if ((stage === 'open' || stage === 'solo-open') && action.kind === 'open') {
        const expected = stage === 'open' ? FIRST_ROOM : SECOND_ROOM;
        if (action.name !== expected.name) {
          setFeedback('You opened ' + action.name + '. Go back to Rooms and find ' + expected.name + '.');
          return;
        }
        // Preserve the real link click before route navigation. The final
        // Check my answer always fetches the actual saved room/report from API.
        moveTo(stage === 'open' ? { stage: 'answer', solaceId: action.id } :
          { ...progress, stage: 'solo-answer', perchId: action.id });
        setFeedback('You found the correct room. Read Guest matters before answering.');
      }
    };
    window.addEventListener(ROOM_PRACTICE_EVENT, handle);
    return () => window.removeEventListener(ROOM_PRACTICE_EVENT, handle);
  }, [active, stage, moveTo, progress]);

  async function checkAnswer() {
    if (!answer || checking) return;
    const expected = stage === 'answer' ? FIRST_ROOM : SECOND_ROOM;
    const id = stage === 'answer' ? progress.solaceId : progress.perchId;
    if (!id || path !== '/rooms/' + id) {
      setFeedback('First open ' + expected.name + ' in the Rooms screen. Then check your answer.');
      return;
    }
    setChecking(true);
    try {
      const issue = await verifyOpenedRoom(id, expected);
      if (!issue) {
        setFeedback('We could not find the practice report. Ask your trainer to check the sample records.');
      } else if (answer !== issue.status) {
        setFeedback('That is not the saved status. Look under Guest matters in ' + expected.name +
          '. Find the report, read its status label, then try again.');
      } else if (stage === 'answer') {
        moveTo({ stage: 'solo-search', solaceId: id });
        setShowArrows(false);
        setFeedback('Correct. Now try Perch 1 on your own. You can open a hint if needed.');
        router.push('/rooms');
      } else {
        // All read-only steps and both authenticated database checks completed.
        localStorage.removeItem(key);
        setActive(false);
        window.dispatchEvent(new Event(ROOM_PRACTICE_FINISHED));
      }
    } catch {
      setFeedback('Could not check your answer. Make sure the practice app is running and try again.');
    } finally { setChecking(false); }
  }

  if (!active || process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return null;

  const guided = ['filter', 'search', 'open', 'answer'].includes(stage);
  const inRooms = path === '/rooms';
  const inDetail = path.startsWith('/rooms/');
  const stepNumber: Record<RoomMissionStage, number> = {
    intro: 1, filter: 2, search: 3, open: 4, answer: 5,
    'solo-search': 6, 'solo-open': 6, 'solo-answer': 7,
  };
  const title: Record<RoomMissionStage, string> = {
    intro: 'A guest reports an AC problem in Solace',
    filter: 'Show guest rooms',
    search: 'Find Solace',
    open: 'Open Solace',
    answer: 'Read the saved guest report',
    'solo-search': 'Your turn: Find Perch 1',
    'solo-open': 'Your turn: Open Perch 1',
    'solo-answer': 'Your turn: Check the guest report',
  };
  const instruction: Record<RoomMissionStage, string> = {
    intro: 'A practice guest says the air conditioner in Solace is not cooling. First check whether staff already recorded the problem.',
    filter: 'Click Guest rooms. You should see only bedrooms, not shared areas.',
    search: 'Type Solace into Search rooms and areas. Check the spelling.',
    open: 'Click the card named Solace. Do not open a different room.',
    answer: 'Look under Guest matters. Find “Solace AC not cooling” and read its status.',
    'solo-search': 'Without arrows, use the Rooms screen to find Perch 1. Type its full name in the search box.',
    'solo-open': 'Open the Perch 1 room card. Read the existing guest report.',
    'solo-answer': 'Find “Perch 1 towel request” under Guest matters. Choose the status shown on the saved report.',
  };
  const spotlightTargets = stage === 'filter' ? [{ selector: '[aria-label="Space type"] button', containsText: 'Guest rooms' }]
    : stage === 'search' ? [{ selector: 'input[aria-label="Search rooms and areas"]' }]
    : stage === 'open' ? [{ selector: 'a.space-card[aria-label="Open Solace"]' }]
    : [];

  return <>
    <section className="room-mission" data-testid="frontdesk-room-mission" aria-label="Front Desk room practice">
      <div className="room-mission-top">
        <span>FRONT DESK · ROOM PRACTICE</span>
        <strong>{stage === 'intro' ? 'Start' : 'Step ' + stepNumber[stage] + ' of 7'}</strong>
      </div>
      <div className="room-mission-progress" aria-hidden="true"><span style={{ width: (stepNumber[stage] / 7 * 100) + '%' }} /></div>
      <h2>{title[stage]}</h2>
      <p>{instruction[stage]}</p>
      {stage === 'intro' ? <>
        <details className="room-mission-example">
          <summary>Show me an example</summary>
          <p><strong>Example:</strong> Open Rooms → Guest rooms → Search Solace → Open the room → Read Guest matters.</p>
          <p>When a report is already there, read it before asking someone to create another one.</p>
        </details>
        <button type="button" className="room-mission-primary" onClick={() => {
          moveTo({ stage: 'filter' }); setShowArrows(true); setFeedback('');
          router.push('/rooms');
        }}>Help me do it →</button>
      </> : <>
        {(stage === 'answer' || stage === 'solo-answer') && <div className="room-mission-question">
          <label htmlFor="room-mission-status">What status is shown on the guest report?</label>
          <select id="room-mission-status" value={answer} onChange={e => setAnswer(e.target.value)}>
            <option value="">Choose the saved status…</option>
            <option value="Open">Open</option><option value="Follow">Needs follow-up (Follow)</option>
            <option value="Done">Done</option>
          </select>
          <button type="button" className="room-mission-primary" disabled={!answer || checking}
            onClick={() => void checkAnswer()}>{checking ? 'Checking…' : 'Check my answer'}</button>
        </div>}
        {(!inRooms && !inDetail) || (['filter','search','open','solo-search','solo-open'].includes(stage) && !inRooms) ||
          (['answer','solo-answer'].includes(stage) && !inDetail)
          ? <button type="button" className="room-mission-primary" onClick={() => router.push('/rooms')}>Open Rooms →</button> : null}
        <div className="room-mission-help">
          {guided && <button type="button" onClick={() => setShowArrows(value => !value)}>
            {showArrows ? 'Hide arrow' : 'Show me where'}</button>}
          <button type="button" onClick={() => setShowHelp(value => !value)}>
            {showHelp ? 'Hide help' : 'Need help?'}</button>
        </div>
        {showHelp && <p className="room-mission-hint">
          {stage === 'solo-search' || stage === 'solo-open' || stage === 'solo-answer'
            ? 'Go to Rooms, search Perch 1, open it, and read Guest matters. The status is printed on the saved report.'
            : 'Go to Rooms and use the highlighted button or search box. For a guest report, read the status label under Guest matters.'}
        </p>}
      </>}
      {feedback && <p className="room-mission-feedback" role="status">{feedback}</p>}
      <small>Practice only. Room names are from Hidden Oasis; guest reports are made up. Nothing changes live records.</small>
    </section>
    {showArrows && guided && spotlightTargets.length > 0 && inRooms && <TrainingSpotlight
      key={stage} title={title[stage]} description={instruction[stage]}
      stepLabel={'DO THIS NOW · STEP ' + stepNumber[stage] + ' OF 7'}
      targets={spotlightTargets} onClose={() => setShowArrows(false)} />}
  </>;
}
