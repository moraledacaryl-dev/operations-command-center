'use client';

import Link from 'next/link';
import { TrainingSpotlight } from '@/components/TrainingSpotlight';
import { workflowFocus, currentWorkflowFocus } from '@/lib/training-workflow-focus';
import type { WorkflowFocus } from '@/lib/training-workflow-focus';
import { makeTrainingReference } from '@/lib/training-workflows';
import { COURSE_STORAGE_PREFIX } from '@/lib/training-course';
import { useCallback, useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { getCurrentDepartmentId } from '@/lib/session';
import {
  parseWorkflowSession, verifyWorkflowStep, workflowInstructions, workflowStagePath,
  workflowOwnerId, workflowSessionKey, workflowResultsKey,
  WORKFLOW_CHANGED, WORKFLOW_DEFINITIONS,
} from '@/lib/training-workflows';
import type { TrainingWorkflowSession, TrainingWorkflowResults } from '@/lib/training-workflows';

type Props = { user: Entity; path: string };

/**
 * Nonproduction-only sticky coach. Employees operate the REAL training UI;
 * this panel checks persisted fictional data via its local backend.
 */
export function TrainingWorkflowCoach({ user, path }: Props) {
  const identity = workflowOwnerId(user);
  const storageKey = workflowSessionKey(user);
  const [session, setSession] = useState<TrainingWorkflowSession | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const [liveFocus, setLiveFocus] = useState<WorkflowFocus | null>(null);

  const refresh = useCallback(() => {
    try { setSession(parseWorkflowSession(localStorage.getItem(storageKey), identity)); }
    catch { setSession(null); }
  }, [storageKey, identity]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return;
    refresh();
    window.addEventListener(WORKFLOW_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(WORKFLOW_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  useEffect(() => { setMessage(''); }, [path, session?.reference, session?.step]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true' || !session) {
      setLiveFocus(null);
      return;
    }
    let animation = 0;
    const onModule = path === workflowStagePath(session);
    const refreshFocus = () => {
      const next = currentWorkflowFocus(session, onModule);
      setLiveFocus(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => {
      window.cancelAnimationFrame(animation);
      animation = window.requestAnimationFrame(refreshFocus);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true });
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    refreshFocus();
    return () => {
      window.cancelAnimationFrame(animation);
      observer.disconnect();
      document.removeEventListener('input', schedule, true);
      document.removeEventListener('change', schedule, true);
    };
  }, [path, session?.kind, session?.reference, session?.step, session?.ownerId]);

  if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true' ||
    !session || !hasCapability(user, 'manage_department') ||
    (['mt-light-fault', 'fd-broken-shower'].includes(session.kind) &&
      !hasCapability(user, 'make_decisions'))) return null;

  const definition = WORKFLOW_DEFINITIONS[session.kind];
  const finished = session.step >= definition.stages.length;
  const expectedPath = workflowStagePath(session);
  const onModule = path === expectedPath;
  const currentStage = definition.stages[session.step];
  const instructions = finished ? [] : workflowInstructions(session);
  const focus = !finished ? liveFocus || workflowFocus(session, onModule) : null;

  async function checkSavedWork() {
    if (!session || busy || finished) return;
    setBusy(true);
    setMessage('');
    try {
      const departmentId = getCurrentDepartmentId(user);
      const records = session.step === 0
        ? await api.listAll(definition.resource, {
            active: definition.resource === 'requests' ? false : true,
            department_id: departmentId || '',
          })
        : [];
      const detail = session.step > 0 && session.recordId
        ? await api.get(definition.resource, session.recordId)
        : null;
      const linkedId = session.kind === 'fd-broken-shower' && detail
        ? Number(detail.linked_fix_id)
        : 0;
      const relatedDetail = Number.isSafeInteger(linkedId) && linkedId > 0
        ? await api.get('fixes', linkedId)
        : null;
      const linkedApprovals = session.kind === 'manager-evidence' && session.step > 0
        ? await api.listAll('approvals', { active: false, department_id: departmentId || '' })
        : [];
      const outcome = verifyWorkflowStep(session, records, detail, relatedDetail, linkedApprovals);
      if (!outcome.passed) {
        setMessage(outcome.error);
        return;
      }
      const next = {
        ...session,
        recordId: outcome.recordId || session.recordId,
        relatedRecordId: outcome.relatedRecordId || session.relatedRecordId,
        step: session.step + 1,
      };
      // Persist stage advancement only after the authenticated training API
      // returns the expected record with the original unique reference.
      localStorage.setItem(storageKey, JSON.stringify(next));
      if (next.step >= definition.stages.length && next.recordId) {
        let saved: TrainingWorkflowResults = {};
        try { saved = JSON.parse(localStorage.getItem(workflowResultsKey(user)) || '{}') || {}; }
        catch { /* Unreadable progress must never authorize a pass. */ }
        saved[session.kind] = {
          reference: session.reference,
          recordId: next.recordId,
          ...(next.relatedRecordId ? { relatedRecordId: next.relatedRecordId } : {}),
          completedAt: new Date().toISOString(),
          steps: [...definition.stages],
        };
        localStorage.setItem(workflowResultsKey(user), JSON.stringify(saved));
      }
      setSession(next);
      window.dispatchEvent(new Event(WORKFLOW_CHANGED));
    } catch (err: unknown) {
      setMessage('Training could not verify the saved record. Check that the local training service is open and that you are signed in, then try again. ' +
        (err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  }

  function requiredCoursePractice() {
    if (!session) return false;
    try {
      const course: unknown = JSON.parse(localStorage.getItem(COURSE_STORAGE_PREFIX + identity) || 'null');
      if (!course || typeof course !== 'object' || Array.isArray(course)) return false;
      const state = course as Record<string, unknown>;
      return state.stage === 'work' && state.reference === session.reference;
    } catch { return false; }
  }

  function repeatWorkflow() {
    if (!session || busy) return;
    if (requiredCoursePractice()) {
      setMessage('This practice is required for the current lesson. Finish it first; you can repeat the whole lesson afterward without losing your earlier results.');
      return;
    }
    const next: TrainingWorkflowSession = {
      kind: session.kind, ownerId: identity,
      reference: makeTrainingReference(session.kind),
      createdAt: new Date().toISOString(), step: 0,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSession(next);
      setShowArrows(true);
      setMessage('Fresh lesson started. Use the NEW unique reference; previous results are preserved.');
      window.dispatchEvent(new Event(WORKFLOW_CHANGED));
    } catch { setMessage('Unable to restart the practice lesson because local storage is unavailable.'); }
  }

  function endSession() {
    if (requiredCoursePractice()) {
      setMessage('You cannot skip this lesson’s saved-work practice. Continue on the highlighted page and choose Check saved work when ready.');
      return;
    }
    try { localStorage.removeItem(storageKey); } catch { /* no remote mutation */ }
    setSession(null);
    setMessage('');
    window.dispatchEvent(new Event(WORKFLOW_CHANGED));
  }

  return <section className="training-workflow-coach" data-testid="training-workflow-coach"
    aria-label="Interactive practice coach">
    <div className="training-workflow-header">
      <div>
        <span className="training-workflow-kicker">FICTIONAL HANDS-ON TRAINING</span>
        <h2>{definition.name}</h2>
        <p>{finished
          ? 'All required record changes were verified in the local training database.'
          : `Stage ${session.step + 1} of ${definition.stages.length}: ${currentStage}`}</p>
      </div>
      <div className="training-workflow-header-actions">
        <Link href="/training" className="btn small secondary">Training catalog</Link>
        <button type="button" className="btn small secondary" data-testid="repeat-real-workflow" onClick={repeatWorkflow} disabled={busy}>↻ Repeat lesson</button>
        <button type="button" className="btn small secondary" data-testid="show-workflow-arrows" onClick={() => setShowArrows(value => !value)}>{showArrows ? 'Hide arrows' : 'Show arrows'}</button>
        <button type="button" className="btn small secondary" onClick={endSession}>
          {finished ? 'Close coach' : 'Exit exercise'}</button>
      </div>
    </div>
    <p className="training-workflow-reference"><strong>Use this exact reference in the title:</strong>{' '}
      <code data-testid="training-workflow-reference">{session.reference}</code>
      <button type="button" className="btn small secondary" onClick={() => {
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(session.reference).then(() => setMessage('Reference copied.')).catch(() => setMessage('Select and copy the reference shown above.'));
        } else setMessage('Select and copy the reference shown above.');
      }}>Copy</button>
    </p>
    {!finished && <p className="training-workflow-action-now" data-testid="training-workflow-action-now"><strong>DO THIS NOW →</strong> {focus?.text}</p>}
    {!finished && session.step === 0 && <p className="training-workflow-safe" data-testid="workflow-risk-explanation">
      <strong>How to judge urgency:</strong> What is at stake if no one acts? How soon could the consequence happen? Routine can wait for planned work; High requires prompt ownership because the impact matters; Critical demands immediate protection or exceptional escalation. Actual form labels may vary (Normal / Urgent). Use the same thinking and seek qualified help for an uncertain safety hazard.
    </p>}
    {finished ? <p className="training-workflow-finished" role="status">
      Verified practice complete. This is not an employment competency certification; supervisor sign-off and independent real-workflow testing remain separate.
    </p> : <>
      <ol className="training-workflow-instructions">
        {instructions.map(item => <li key={item}>{item}</li>)}
      </ol>
      <p className="training-workflow-modal-help">
        After saving or updating an open record, select <strong>Close</strong> in its details panel.
        Then use <strong>Check saved work</strong> here. Closing a details panel does not
        undo your saved action.
      </p>
      <div className="training-workflow-buttons">
        {!onModule ? <Link className="btn" data-testid="training-open-module" href={expectedPath}>
          Open {session.kind === 'fd-broken-shower' && session.step >= 2
            ? 'Maintenance'
            : ({ guests: 'Guest Matters', tasks: 'Tasks', 'shift-notes': 'Shift Handover',
                fixes: 'Maintenance', requests: 'Requests' } as const)[definition.resource]}</Link> : null}
        <button type="button" className="btn" data-testid="training-check-work" disabled={busy}
          onClick={() => void checkSavedWork()}>{busy ? 'Checking saved records…' : 'Check saved work'}</button>
      </div>
    </>}
    {message && <p className="training-workflow-message" role="status" data-testid="training-workflow-message">{message}</p>}
    <p className="training-workflow-safe">All records must be fictional. No production database, guest details or external integrations are permitted. The coach only reads records to verify your actions; it cannot save them for you.</p>
    {showArrows && !finished && focus && <TrainingSpotlight
      key={session.reference + ':' + session.step + ':' + expectedPath}
      title={focus.title} description={focus.text}
      stepLabel={'REAL OPERATIONS • STAGE ' + (session.step + 1) + ' / ' + definition.stages.length}
      targets={focus.targets} onClose={() => setShowArrows(false)} />}
    {showArrows && finished && <TrainingSpotlight
      title="Lesson finished — you can practise it again"
      description="The saved record changes passed the training backend checks. You can repeat with a fresh fictional reference and your earlier completion remains recorded."
      stepLabel="COMPLETED" targets={[{ selector: '[data-testid="repeat-real-workflow"]' }]}
      onRepeat={repeatWorkflow} onClose={() => setShowArrows(false)} />}
  </section>;
}
