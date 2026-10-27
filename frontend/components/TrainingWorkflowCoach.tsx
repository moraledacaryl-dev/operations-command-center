'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { getCurrentDepartmentId } from '@/lib/session';
import {
  parseWorkflowSession, verifyWorkflowStep, workflowInstructions,
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

  if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true' ||
    !session || !hasCapability(user, 'manage_department')) return null;

  const definition = WORKFLOW_DEFINITIONS[session.kind];
  const finished = session.step >= definition.stages.length;
  const onModule = path === definition.path;
  const currentStage = definition.stages[session.step];
  const instructions = finished ? [] : workflowInstructions(session);

  async function checkSavedWork() {
    if (!session || busy || finished) return;
    setBusy(true);
    setMessage('');
    try {
      const departmentId = getCurrentDepartmentId(user);
      const records = session.step === 0
        ? await api.listAll(definition.resource, { active: true, department_id: departmentId || '' })
        : [];
      const detail = session.step > 0 && session.recordId
        ? await api.get(definition.resource, session.recordId)
        : null;
      const outcome = verifyWorkflowStep(session, records, detail);
      if (!outcome.passed) {
        setMessage(outcome.error);
        return;
      }
      const next = {
        ...session,
        recordId: outcome.recordId || session.recordId,
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

  function endSession() {
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
    {finished ? <p className="training-workflow-finished" role="status">
      Verified practice complete. This is not an employment competency certification; supervisor sign-off and independent real-workflow testing remain separate.
    </p> : <>
      <ol className="training-workflow-instructions">
        {instructions.map(item => <li key={item}>{item}</li>)}
      </ol>
      <div className="training-workflow-buttons">
        {!onModule ? <Link className="btn" data-testid="training-open-module" href={definition.path}>
          Open {({ guests: 'Guest Matters', tasks: 'Tasks', 'shift-notes': 'Shift Handover', fixes: 'Maintenance' } as const)[definition.resource]}</Link> : null}
        <button type="button" className="btn" data-testid="training-check-work" disabled={busy}
          onClick={() => void checkSavedWork()}>{busy ? 'Checking saved records…' : 'Check saved work'}</button>
      </div>
    </>}
    {message && <p className="training-workflow-message" role="status" data-testid="training-workflow-message">{message}</p>}
    <p className="training-workflow-safe">All records must be fictional. No production database, guest details or external integrations are permitted. The coach only reads records to verify your actions; it cannot save them for you.</p>
  </section>;
}
