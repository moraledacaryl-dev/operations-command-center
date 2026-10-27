/**
 * Real Operations-workspace practice. Never enable this outside the isolated
 * NEXT_PUBLIC_TRAINING_MODE build. All checks read back persisted fictional
 * records; a click, a filled form, or a mock completion flag cannot pass.
 * Completion is learning evidence, NOT a credential or staff certification.
 */
export type TrainingWorkflowKind = 'guest-ac' | 'shared-no-owner';
export type TrainingWorkflowSession = {
  kind: TrainingWorkflowKind;
  ownerId: string;
  reference: string;
  createdAt: string;
  step: number;
  recordId?: number;
};
export type TrainingWorkflowEvidence = {
  reference: string;
  recordId: number;
  completedAt: string;
  steps: string[];
};
export type TrainingWorkflowResults = Partial<Record<TrainingWorkflowKind, TrainingWorkflowEvidence>>;

export const WORKFLOW_CHANGED = 'ho-ops-training-workflow-updated';
export const WORKFLOW_PREFIX = 'ho-ops-verified-workflow-v1:';
export const WORKFLOW_RESULTS_PREFIX = 'ho-ops-workflow-results-v1:';

export const WORKFLOW_DEFINITIONS = {
  'guest-ac': {
    name: 'Guest complaint to documented follow-up',
    path: '/guests',
    resource: 'guests',
    stages: ['Create a guest matter', 'Record an accountable follow-up'],
  },
  'shared-no-owner': {
    name: 'Assign and progress a real task',
    path: '/tasks',
    resource: 'tasks',
    stages: ['Create and assign a task', 'Start the assigned task', 'Submit the task for review'],
  },
} as const;

export const isTrainingWorkflowKind = (value: unknown): value is TrainingWorkflowKind =>
  value === 'guest-ac' || value === 'shared-no-owner';

export function workflowOwnerId(user: { id?: string | number; email?: string }): string {
  return String(user.id || user.email || '');
}

export function workflowSessionKey(user: { id?: string | number; email?: string }): string {
  return WORKFLOW_PREFIX + workflowOwnerId(user);
}

export function workflowResultsKey(user: { id?: string | number; email?: string }): string {
  return WORKFLOW_RESULTS_PREFIX + workflowOwnerId(user);
}

export function makeTrainingReference(kind: TrainingWorkflowKind): string {
  // Localhost is a secure context. The fallback is only for older desktop webviews.
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8).toUpperCase()
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();
  return (kind === 'guest-ac' ? 'TRN-GUEST-' : 'TRN-TASK-') + suffix;
}

export function parseWorkflowSession(raw: string | null, ownerId: string): TrainingWorkflowSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || !isTrainingWorkflowKind(value.kind) || value.ownerId !== ownerId ||
      typeof value.reference !== 'string' || !/^TRN-(GUEST|TASK)-[A-Z0-9]{8,20}$/.test(value.reference) ||
      !Number.isInteger(value.step) || value.step < 0 ||
      value.step > WORKFLOW_DEFINITIONS[value.kind].stages.length ||
      typeof value.createdAt !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

export type WorkflowCheck = { passed: boolean; error: string; recordId?: number; stepName?: string };
type OperationalRecord = Record<string, unknown>;

function readable(value: unknown) { return String(value || '').trim().toLowerCase(); }
function positiveId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Validate a persisted record, not a locally typed form or frontend event. */
export function verifyWorkflowStep(
  session: TrainingWorkflowSession,
  candidates: OperationalRecord[],
  detail?: OperationalRecord | null,
): WorkflowCheck {
  const definition = WORKFLOW_DEFINITIONS[session.kind];
  const matched = candidates.filter(item => readable(item.title).includes(session.reference.toLowerCase()));
  if (session.step === 0) {
    const valid = matched.find(item => {
      if (!positiveId(item.id)) return false;
      if (session.kind === 'guest-ac') {
        const note = readable(item.note);
        return readable(item.urgency) === 'high' &&
          ['room', 'complaint'].includes(readable(item.issue_type)) &&
          /\b(ac|air.condition|aircon|cooling|warm air)\b/.test(note) &&
          /\b(maintenance|inspect|technician|repair)\b/.test(note) &&
          /\b(update|call|follow.up|notify)\b/.test(note);
      }
      return readable(item.priority) === 'high' &&
        positiveId(item.assigned_to_id) !== undefined;
    });
    if (valid) return { passed: true, error: '', recordId: positiveId(valid.id), stepName: definition.stages[0] };
    return { passed: false, error: matched.length
      ? session.kind === 'guest-ac'
        ? 'A matching case exists, but its saved record must have High urgency, Room or Complaint type, and a note describing the AC fault, Maintenance action, and guest follow-up. Correct the case according to authorized controls, or create a corrected fictional one with the same reference.'
        : 'A matching task exists, but its saved record must be High priority and have an actual assigned person. Open the task, edit it, and save those fields.'
      : 'No saved record with your unique training reference was found yet. Open the correct module, use the actual New button, fill in the details, and save before checking again.' };
  }
  if (!session.recordId || !detail || positiveId(detail.id) !== session.recordId ||
    !readable(detail.title).includes(session.reference.toLowerCase())) {
    return { passed: false, error: 'The original training record could not be verified. Refresh the correct record and retry; do not create a different unlinked case.' };
  }
  const status = readable(detail.status);
  if (session.kind === 'guest-ac') {
    return status === 'follow'
      ? { passed: true, error: '', recordId: session.recordId, stepName: definition.stages[1] }
      : { passed: false, error: 'The saved guest matter is not in Needs follow-up yet. Open the original matter, choose Needs follow-up, and save that real status transition.' };
  }
  if (session.step === 1) {
    return status === 'doing'
      ? { passed: true, error: '', recordId: session.recordId, stepName: definition.stages[1] }
      : { passed: false, error: 'The saved task must be in Doing. Open the original task and click Start work, then check again.' };
  }
  return status === 'review'
    ? { passed: true, error: '', recordId: session.recordId, stepName: definition.stages[2] }
    : { passed: false, error: 'The saved task must be in Review. Open the original Doing task, click Submit for review, and check again.' };
}

export function workflowInstructions(session: TrainingWorkflowSession): string[] {
  if (session.kind === 'guest-ac') {
    return session.step === 0
      ? ['Open Guest Matters and click New guest matter.', 'Include the exact training reference in the Matter title.', 'Select Room or Complaint, choose High urgency, and use Room 205 if it appears in the fictional room list.', 'In the context note, describe the AC blowing warm air, the Maintenance inspection request, and when Front Desk will update the guest.', 'Click Save matter. Only then click Check saved work.']
      : ['Find the saved matter with your reference in the Active list.', 'Open it, choose Needs follow-up, and confirm the updated record.', 'Click Check saved work to verify the saved status. Do not resolve an uninspected AC fault.'];
  }
  if (session.step === 0) return [
    'Open Tasks and click New task.',
    'Include your exact training reference in the Task title.',
    'Set priority to High and select a fictional assignee in the Assigned to menu.',
    'Click Create task. Verify that it appears in your Tasks workspace, then click Check saved work.',
  ];
  if (session.step === 1) return [
    'Locate the same task in To Do and click to open it.',
    'Click Start work. Verify that it moved to Doing.',
    'Click Check saved work to validate this saved transition.',
  ];
  return [
    'Open the same Doing task.',
    'Click Submit for review. This does NOT mean work was independently verified or completed.',
    'Click Check saved work to validate the persisted Review state.',
  ];
}
