'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Entity } from '@/lib/api';
import { DEPARTMENT_CHANGE_EVENT, getCurrentDepartmentId, setCurrentDepartmentId } from '@/lib/session';
import { COURSE_STORAGE_PREFIX } from '@/lib/training-course';
import { TrainingSpotlight } from '@/components/TrainingSpotlight';
import { SHIFT_MISSION_PREFIX, SHIFT_PRACTICE_FINISHED,
  departmentShiftTitle, parseShiftMission, verifyShiftRecord,
} from '@/lib/training-shift-mission';
import type { ShiftMissionProgress, ShiftMissionStage } from '@/lib/training-shift-mission';

export function DepartmentShiftPractice({ user, path }: { user: Entity; path: string }) {
  const router = useRouter();
  const identity = String(user.id || user.email || '');
  const key = SHIFT_MISSION_PREFIX + identity;
  const courseKey = COURSE_STORAGE_PREFIX + identity;
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState<ShiftMissionProgress>({ stage: 'intro' });
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showArrow, setShowArrow] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const department = Array.isArray(user.departments)
    ? (user.departments.find((d: Entity) => Number(d.id) === Number(user.primary_department_id))
      || user.departments[0]) : undefined;
  const departmentName = String(department?.name || '');
  const departmentId = Number(department?.id || user.primary_department_id || user.department_id || 0);
  const stage = progress.stage;
  const guidedTitle = departmentShiftTitle(departmentName, 'guided');
  const soloTitle = departmentShiftTitle(departmentName, 'solo');
  const wrongDepartment = selectedDepartmentId !== null && selectedDepartmentId !== departmentId;

  useEffect(() => {
    const sync = () => setSelectedDepartmentId(getCurrentDepartmentId(user));
    sync();
    window.addEventListener(DEPARTMENT_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(DEPARTMENT_CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, [user]);

  const refresh = useCallback(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(courseKey) || 'null');
      const correctLesson = saved?.lessonId === 'staff-handover' && saved?.stage === 'shift-practice';
      const eligible = user.role === 'staff' && departmentId > 0 && Boolean(departmentName);
      setActive(Boolean(correctLesson && eligible));
      if (correctLesson && eligible) setProgress(parseShiftMission(localStorage.getItem(key)));
    } catch { setActive(false); }
  }, [courseKey, key, user.role, departmentId, departmentName]);

  useEffect(() => {
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('ho-training-course-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('ho-training-course-changed', refresh);
    };
  }, [refresh, path]);

  const moveTo = useCallback((value: ShiftMissionProgress) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { setFeedback('Your progress could not be saved. Ask your trainer before leaving the app.'); }
    setProgress(value);
    setAnswer('');
    setShowHelp(false);
  }, [key]);

  useEffect(() => {
    if (!active || path !== '/shift' || wrongDepartment) return;
    let attached = true;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const filter = target.closest('[aria-label="Shift note filters"] button');
      if (stage === 'filter' && filter?.textContent?.trim() === 'Urgent') {
        moveTo({ stage: 'open' });
        setFeedback('Good. Find the Night handover from your department.');
        return;
      }
      if (stage !== 'open' && stage !== 'solo-open') return;
      const card = target.closest('.ops-handover-card');
      if (!card) return;
      const clickedTitle = card.querySelector('.ops-handover-body > strong')?.textContent?.trim();
      const expected = stage === 'open' ? guidedTitle : soloTitle;
      if (clickedTitle !== expected) {
        setFeedback('That is a different handover. Close it and open “' + expected + '”.');
        return;
      }
      // Read the real authorized local training API. Clicking unrelated cards or
      // entering guessed IDs cannot advance to the answer stage.
      void api.listAll('shift-notes', { active: true, department_id: departmentId })
        .then(async rows => {
          const match = rows.find(row => row.title === expected && Number(row.department_id) === departmentId);
          if (!match) throw new Error('Missing fictional shift note');
          const found = verifyShiftRecord(await api.get('shift-notes', Number(match.id)), expected, departmentId);
          if (!attached || !found) throw new Error('Practice note did not match');
          moveTo(stage === 'open' ? { stage: 'answer', firstId: found.id }
            : { ...progress, stage: 'solo-answer', secondId: found.id });
          setFeedback('Read the saved status, then close the handover details and choose your answer.');
        }).catch(() => { if (attached) setFeedback('Could not check this training note. Ask your trainer to check the practice data.'); });
    };
    document.addEventListener('click', onClick, true);
    return () => { attached = false; document.removeEventListener('click', onClick, true); };
  }, [active, stage, path, guidedTitle, soloTitle, departmentId, progress, moveTo, wrongDepartment]);

  async function checkAnswer() {
    if (!answer || busy || wrongDepartment) return;
    const id = stage === 'answer' ? progress.firstId : progress.secondId;
    if (!id || path !== '/shift') {
      setFeedback('Open the correct handover in Shift handover before checking your answer.');
      return;
    }
    setBusy(true);
    try {
      const current = await api.get('shift-notes', id);
      const expected = stage === 'answer' ? guidedTitle : soloTitle;
      const record = verifyShiftRecord(current, expected, departmentId);
      if (!record) {
        setFeedback('The practice handover could not be checked. Ask your trainer to verify the fictional records.');
      } else if (answer !== record.status) {
        setFeedback('Look at the status on the handover details. Your answer does not match the saved record. Try again.');
      } else if (stage === 'answer') {
        moveTo({ stage: 'solo-open', firstId: id });
        setShowArrow(false);
        setFeedback('Correct. Now find the PM handover in your department on your own.');
      } else {
        localStorage.removeItem(key);
        setActive(false);
        window.dispatchEvent(new Event(SHIFT_PRACTICE_FINISHED));
      }
    } catch {
      setFeedback('Could not check the saved note. Check your connection to the practice app and try again.');
    } finally { setBusy(false); }
  }

  if (!active || process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return null;

  const isGuided = ['filter','open','answer'].includes(stage);
  const titles: Record<ShiftMissionStage,string> = {
    intro: 'Read a real-looking handover',
    filter: 'Find the urgent handovers',
    open: 'Open your department’s Night handover',
    answer: 'Check the saved handover status',
    'solo-open': 'Your turn: Find the PM handover',
    'solo-answer': 'Your turn: Read its status',
  };
  const steps: Record<ShiftMissionStage,string> = {
    intro: 'A fictional shift note says that work is still unfinished. Learn to read a handover before taking over a task.',
    filter: 'Choose Urgent in the Shift note filters. The urgent Night note should be listed.',
    open: 'Find “' + guidedTitle + '” and click its card. Read what the previous shift recorded.',
    answer: 'In the handover details, read the status label. Close the details, then choose that status here.',
    'solo-open': 'Without arrows, use PM or Unresolved to find “' + soloTitle + '”. Open its card.',
    'solo-answer': 'Read the status for “' + soloTitle + '”. Close the details, then choose the same status here.',
  };
  const number: Record<ShiftMissionStage,number> = {
    intro: 1, filter: 2, open: 3, answer: 4, 'solo-open': 5, 'solo-answer': 6,
  };
  const targets = stage === 'filter' ? [{ selector: '[aria-label="Shift note filters"] button', containsText: 'Urgent' }]
    : stage === 'open' ? [{ selector: '.ops-handover-card', containsText: guidedTitle }] : [];

  return <>
    <section className="room-mission" data-testid="department-shift-practice" aria-label="Department handover practice">
      <div className="room-mission-top">
        <span>{departmentName.toUpperCase()} · HANDOVER PRACTICE</span>
        <strong>{stage === 'intro' ? 'Start' : 'Step ' + number[stage] + ' of 6'}</strong>
      </div>
      <div className="room-mission-progress" aria-hidden="true"><span style={{ width: number[stage] / 6 * 100 + '%' }} /></div>
      <h2>{titles[stage]}</h2>
      <p>{steps[stage]}</p>
      {stage === 'intro' ? <>
        <details className="room-mission-example"><summary>Show me an example</summary>
          <p>Open Shift handover → Urgent → find the Night handover for {departmentName} → read the status on the note.</p>
          <p>Read before acting. A handover tells the next shift what is still waiting.</p>
        </details>
        <p>This practice uses {departmentName} handovers. We&apos;ll open that team for you.</p>
        <button type="button" className="room-mission-primary" onClick={() => {
          setCurrentDepartmentId(departmentId);
          moveTo({ stage: 'filter' }); setShowArrow(true); setFeedback('');
          router.push('/shift');
        }}>Help me do it →</button>
      </> : <>
        {wrongDepartment && <p role="status">This practice uses {departmentName} handovers. <button type="button" onClick={() => setCurrentDepartmentId(departmentId)}>Switch to {departmentName}</button></p>}
        {stage === 'answer' || stage === 'solo-answer' ? <div className="room-mission-question">
          <label htmlFor="shift-mission-status">What status is shown on this handover?</label>
          <select id="shift-mission-status" value={answer} onChange={event=>setAnswer(event.target.value)}>
            <option value="">Choose the saved status…</option>
            <option value="New">New</option><option value="Seen">Seen</option>
            <option value="Follow">Needs follow-up (Follow)</option><option value="Done">Done</option>
          </select>
          <button type="button" className="room-mission-primary" disabled={!answer || busy || wrongDepartment}
            onClick={() => void checkAnswer()}>{busy ? 'Checking…' : 'Check my answer'}</button>
        </div> : null}
        {path !== '/shift' && <button type="button" className="room-mission-primary"
          onClick={() => router.push('/shift')}>Open Shift handover →</button>}
        <div className="room-mission-help">
          {isGuided && <button type="button" onClick={() => setShowArrow(v=>!v)}>{showArrow ? 'Hide arrow' : 'Show me where'}</button>}
          <button type="button" onClick={() => setShowHelp(v=>!v)}>{showHelp ? 'Hide help' : 'Need help?'}</button>
        </div>
        {showHelp && <p className="room-mission-hint">Use the handover filters above the list. Open the note with the exact title shown here, then read its status. You can try again.</p>}
      </>}
      {feedback && <p className="room-mission-feedback" role="status">{feedback}</p>}
      <small>Practice only. These handovers are fictional. Nothing here changes live resort records.</small>
    </section>
    {showArrow && isGuided && !wrongDepartment && targets.length > 0 && path === '/shift' && <TrainingSpotlight
      key={stage} title={titles[stage]} description={steps[stage]}
      stepLabel={'DO THIS NOW · STEP ' + number[stage] + ' OF 6'}
      targets={targets} onClose={() => setShowArrow(false)} />}
  </>;
}
