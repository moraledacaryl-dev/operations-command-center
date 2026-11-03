/**
 * Real Operations-workspace practice. Never enable this outside the isolated
 * NEXT_PUBLIC_TRAINING_MODE build. All checks read back persisted fictional
 * records; a click, a filled form, or a mock completion flag cannot pass.
 * Completion is learning evidence, NOT a credential or staff certification.
 */
export type TrainingWorkflowKind = 'guest-ac' | 'shared-no-owner' | 'shift-unresolved' | 'mt-light-fault' | 'manager-evidence' | 'fd-broken-shower';
export type TrainingWorkflowSession = {
  kind: TrainingWorkflowKind;
  ownerId: string;
  reference: string;
  createdAt: string;
  step: number;
  recordId?: number;
  relatedRecordId?: number;
};
export type TrainingWorkflowEvidence = {
  reference: string;
  recordId: number;
  relatedRecordId?: number;
  completedAt: string;
  steps: string[];
};
export type TrainingWorkflowResults = Partial<Record<TrainingWorkflowKind, TrainingWorkflowEvidence>>;

export const WORKFLOW_CHANGED = 'ho-ops-training-workflow-updated';
export const WORKFLOW_PREFIX = 'ho-ops-verified-workflow-v1:';
export const WORKFLOW_RESULTS_PREFIX = 'ho-ops-workflow-results-v1:';

export const WORKFLOW_DEFINITIONS = {
  'guest-ac': {
    name: 'Record a guest problem and follow up',
    path: '/guests',
    resource: 'guests',
    stages: ['Create a guest matter', 'Record an accountable follow-up'],
  },
  'shared-no-owner': {
    name: 'Assign and update a task',
    path: '/tasks',
    resource: 'tasks',
    stages: ['Create and assign a task', 'Start the assigned task', 'Submit the task for review'],
  },
  'shift-unresolved': {
    name: 'Write a handover for the next shift',
    path: '/shift',
    resource: 'shift-notes',
    stages: ['Publish a usable handover', 'Carry the unresolved matter forward'],
  },
  'mt-light-fault': {
    name: 'Report and check a broken hallway light',
    path: '/fixes',
    resource: 'fixes',
    stages: ['Report and assign the maintenance issue', 'Start the work order', 'Mark the work ready for verification', 'Verify the finished work'],
  },
  'manager-evidence': {
    name: 'Write a request for equipment',
    path: '/requests',
    resource: 'requests',
    stages: ['Create a defensible equipment request', 'Submit for authorized review'],
  },
  'fd-broken-shower': {
    name: 'Link a guest problem to a repair',
    path: '/guests',
    resource: 'guests',
    stages: ['Log the shower issue with guest follow-up', 'Create the linked maintenance work order',
      'Start linked maintenance', 'Record maintenance as done', 'Verify work and auto-close the guest case'],
  },
} as const;

/** Facts for the independent saved-record exercise, not a pre-filled answer. */
export const WORKFLOW_PRACTICE_SITUATIONS: Record<TrainingWorkflowKind, string> = {
  'guest-ac': 'The Solace AC is blowing warm air and the guest is waiting. Nobody has inspected it yet. Arrange an inspection and a Front Desk update during this shift.',
  'shared-no-owner': 'A shared task is due today, but nobody is assigned. It needs an owner and attention during this shift; no immediate danger is described.',
  'shift-unresolved': 'The Twinspire guest has waited 30 minutes for a toilet repair. The next receptionist starts in five minutes and needs to know who will arrange the repair and call the guest.',
  'mt-light-fault': 'One hallway light is out, while the other corridor lights are working. Arrange prompt inspection and safe temporary lighting. Nobody has checked the fault yet.',
  'manager-evidence': 'The Front Desk radio has failed and a replacement is needed before the next shift today. The fictional estimate is PHP 2500. A supplier quotation has not arrived; say that clearly in the request.',
  'fd-broken-shower': 'The Perch 2 guest reports no hot water. Nobody has inspected the fault. Arrange a Maintenance check and a Front Desk update without promising that the shower is repaired.',
};

/** Display labels are separate so existing saved progress keeps its original step IDs. */
export function workflowStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    'Record an accountable follow-up': 'Arrange the guest follow-up',
    'Publish a usable handover': 'Write the next shift’s note',
    'Carry the unresolved matter forward': 'Leave unfinished work for the next shift',
    'Mark the work ready for verification': 'Mark the repair Done',
    'Create a defensible equipment request': 'Write the equipment request',
    'Submit for authorized review': 'Send the request for review',
    'Verify work and auto-close the guest case': 'Check the repair and close the guest matter',
  };
  return labels[stage] || stage;
}

export const isTrainingWorkflowKind = (value: unknown): value is TrainingWorkflowKind =>
  value === 'guest-ac' || value === 'shared-no-owner' ||
    value === 'shift-unresolved' || value === 'mt-light-fault' ||
    value === 'manager-evidence' || value === 'fd-broken-shower';

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
  const prefix = {
    'guest-ac': 'TRN-GUEST-', 'shared-no-owner': 'TRN-TASK-',
    'shift-unresolved': 'TRN-SHIFT-', 'mt-light-fault': 'TRN-FIX-', 'manager-evidence': 'TRN-REQ-', 'fd-broken-shower': 'TRN-LINK-',
  }[kind];
  return prefix + suffix;
}

export function parseWorkflowSession(raw: string | null, ownerId: string): TrainingWorkflowSession | null {
  if (!raw) return null;
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    const value = decoded as Record<string, unknown>;
    if (!isTrainingWorkflowKind(value.kind) || value.ownerId !== ownerId ||
      typeof value.reference !== 'string' ||
      !/^TRN-(GUEST|TASK|SHIFT|FIX|REQ|LINK)-[A-Z0-9]{8,20}$/.test(value.reference) ||
      typeof value.step !== 'number' || !Number.isInteger(value.step) || value.step < 0 ||
      value.step > WORKFLOW_DEFINITIONS[value.kind].stages.length ||
      typeof value.createdAt !== 'string') return null;
    const recordId = positiveId(value.recordId);
    const relatedRecordId = positiveId(value.relatedRecordId);
    return {
      kind: value.kind,
      ownerId,
      reference: value.reference,
      createdAt: value.createdAt,
      step: value.step,
      ...(recordId ? { recordId } : {}),
      ...(relatedRecordId ? { relatedRecordId } : {}),
    };
  } catch {
    return null;
  }
}

export type WorkflowCheck = { passed: boolean; error: string; recordId?: number; relatedRecordId?: number; stepName?: string };
/** Linked Guest↔Fix exercises move across actual Operations modules. */
export function workflowStagePath(session: TrainingWorkflowSession): string {
  return session.kind === 'fd-broken-shower' && session.step >= 2
    ? '/fixes' : WORKFLOW_DEFINITIONS[session.kind].path;
}
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
  relatedDetail?: OperationalRecord | null,
  relatedApprovals: OperationalRecord[] = [],
): WorkflowCheck {
  const definition = WORKFLOW_DEFINITIONS[session.kind];
  const matched = candidates.filter(item => readable(item.title).includes(session.reference.toLowerCase()));
  if (session.step === 0) {
    const valid = matched.find(item => {
      if (!positiveId(item.id)) return false;
      if (session.kind === 'fd-broken-shower') {
        const note = readable(item.note);
        return readable(item.urgency) === 'high' &&
          ['room', 'complaint'].includes(readable(item.issue_type)) &&
          /shower|hot water/.test(note) &&
          /maintenance|inspect|repair/.test(note) &&
          /guest|call|update|callback/.test(note);
      }
      if (session.kind === 'guest-ac') {
        const note = readable(item.note);
        return readable(item.urgency) === 'high' &&
          ['room', 'complaint'].includes(readable(item.issue_type)) &&
          /\b(ac|air.condition|aircon|cooling|warm air)\b/.test(note) &&
          /\b(maintenance|inspect|technician|repair)\b/.test(note) &&
          /\b(update|call|follow.up|notify)\b/.test(note);
      }
      if (session.kind === 'shared-no-owner') {
        return readable(item.priority) === 'high' && positiveId(item.assigned_to_id) !== undefined;
      }
      if (session.kind === 'manager-evidence') {
        const reason = readable(item.reason);
        return readable(item.request_type) === 'equipment' &&
          readable(item.urgency) === 'urgent' &&
          /quotation|quote|supplier/.test(reason) &&
          /amount|cost|price|budget/.test(reason) &&
          /necessary|need|critical|justif|urgent/.test(reason);
      }
      if (session.kind === 'shift-unresolved') {
        const note = readable(item.note);
        return readable(item.urgency) === 'urgent' &&
          readable(item.category) === 'guest' &&
          /guest/.test(note) &&
          /owner|responsib|assign/.test(note) &&
          /follow|call|update/.test(note);
      }
      const problem = readable(item.problem);
      return readable(item.urgency) === 'high' &&
        positiveId(item.assigned_to_id) !== undefined &&
        /light|lamp/.test(problem) &&
        /hall|corridor|passage/.test(problem);
    });
    if (valid) return { passed: true, error: '', recordId: positiveId(valid.id), stepName: definition.stages[0] };
    return { passed: false, error: matched.length
      ? session.kind === 'guest-ac'
        ? 'The case is saved. Check that its urgency is High and its type is Room or Complaint. The note should explain the AC problem, what Maintenance will do and when Reception will update the guest.'
        : session.kind === 'fd-broken-shower'
          ? 'The saved guest report must have High urgency, Room or Complaint type, and a note about the faulty shower, maintenance inspection, and Front Desk guest callback.'
        : session.kind === 'shared-no-owner'
          ? 'A matching task exists, but its saved record must be High priority and have an actual assigned person. Open the task, edit it, and save those fields.'
          : session.kind === 'shift-unresolved'
            ? 'Your published handover must use Urgent priority, Guest category, and specify the guest concern, a responsible follow-up owner, and the next guest update.'
            : session.kind === 'manager-evidence'
              ? 'Use Equipment type and Urgent priority. In Business reason, say whether you have a supplier quote, what it may cost and why it is needed. Do not claim a quote is attached if it is missing.'
              : 'Your maintenance report must use High urgency, name a fictional technician, and describe the failed corridor lighting in Problem / scope.'
      : 'No saved record with this practice number was found. Open the right screen, choose New, fill in the form and save. Then check again.' };
  }
  if (!session.recordId || !detail || positiveId(detail.id) !== session.recordId ||
    !readable(detail.title).includes(session.reference.toLowerCase())) {
    return { passed: false, error: 'Could not check the original practice entry. Open the same entry and try again. Do not create a new one.' };
  }
  const status = readable(detail.status);
  if (session.kind === 'fd-broken-shower') {
    const linkedId = positiveId(detail.linked_fix_id);
    if (!linkedId || !relatedDetail ||
      positiveId(relatedDetail.id) !== linkedId ||
      positiveId(relatedDetail.linked_guest_note_id) !== session.recordId ||
      !readable(relatedDetail.title).includes(session.reference.toLowerCase())) {
      return { passed: false, error: 'The original Guest Matter has no matching linked repair yet. Open it and choose Create maintenance. A separate, unrelated repair does not count.' };
    }
    // Actual fix_workflow.verify_fix() atomically resolves a linked GuestNote:
    // during repair the Guest Matter is Follow; after verification it is Done.
    const expectedGuestStatus = session.step === 4 ? 'done' : 'follow';
    if (status !== expectedGuestStatus) {
      return { passed: false, error: session.step === 4
        ? 'Verifying the linked work order must also close the original Guest Matter as Done. Check the same guest and maintenance records.'
        : 'The Guest Matter must remain in Follow while Maintenance handles the issue.' };
    }
    if (session.relatedRecordId && linkedId !== session.relatedRecordId) {
      return { passed: false, error: 'The linked maintenance ticket has changed. Do not substitute a different work order for the original handoff.' };
    }
    if (session.step === 1) {
      return { passed: true, error: '', recordId: session.recordId, relatedRecordId: linkedId, stepName: definition.stages[1] };
    }
    const wanted = session.step === 2 ? 'working' : session.step === 3 ? 'done' : 'verified';
    if (readable(relatedDetail.status) !== wanted) {
      return { passed: false, error: session.step === 2
        ? 'The linked Maintenance work order has not been started. Open that same work order and select Start work.'
        : session.step === 3
          ? 'The linked repair is not Done yet. Finish the practice repair step and choose Mark done before asking a manager to check it.'
          : 'Open the same linked repair. Add a Verification note and choose Verify work.' };
    }
    return { passed: true, error: '', recordId: session.recordId, relatedRecordId: linkedId,
      stepName: definition.stages[session.step] };
  }
  if (session.kind === 'guest-ac') {
    return status === 'follow'
      ? { passed: true, error: '', recordId: session.recordId, stepName: definition.stages[1] }
      : { passed: false, error: 'The saved guest matter is not in Needs follow-up yet. Open it, choose Needs follow-up and save.' };
  }
  if (session.kind === 'manager-evidence') {
    if (status !== 'review') {
      return { passed: false, error: 'The original request is not in Review. Open the Draft and choose Send for review. Submission is not approval.' };
    }
    // submit_request() creates exactly one pending Approval tied to this
    // request and department. Do not count a status-only fake submission.
    const linked = relatedApprovals.filter(approval =>
      readable(approval.source_type) === 'ops_need' &&
      positiveId(approval.source_id) === session.recordId &&
      positiveId(approval.department_id) === positiveId(detail.department_id) &&
      readable(approval.status) === 'pending');
    return linked.length === 1 && positiveId(linked[0].id)
      ? { passed: true, error: '', recordId: session.recordId, relatedRecordId: positiveId(linked[0].id), stepName: definition.stages[1] }
      : { passed: false, error: 'Submitting for review must create one Pending Approval linked to this same request and department. Refresh and check the Approval queue; a Request status alone does not pass.' };
  }
  if (session.kind === 'shift-unresolved') {
    return status === 'follow'
      ? { passed: true, error: '', recordId: session.recordId, stepName: definition.stages[1] }
      : { passed: false, error: 'The unresolved handover must be carried forward. Open the saved handover and use Carry forward, then check again.' };
  }
  if (session.kind === 'mt-light-fault') {
    const wanted = session.step === 1 ? 'working' : session.step === 2 ? 'done' : 'verified';
    return status === wanted
      ? { passed: true, error: '', recordId: session.recordId, stepName: definition.stages[session.step] }
      : { passed: false, error: session.step === 1
          ? 'Open the saved lighting work item and choose Start work before checking.'
          : session.step === 2
            ? 'Choose Mark done for this practice repair. This does not mean a real repair has been done.'
            : 'Open the same Done repair. Write what was checked in Verification note, then choose Verify work. A real repair would need an actual inspection.' };
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
  if (session.kind === 'fd-broken-shower') {
    if (session.step === 0) return [
      'Open Guest Matters and choose New guest matter. Put the practice number in Matter.',
      'Choose Room or Complaint. Think about how soon the guest needs help, then choose the urgency. In the note, describe the shower problem, the Maintenance check and when Reception will call the guest.',
      'Choose Save matter. Close the details, then choose Check saved work.',
    ];
    if (session.step === 1) return [
      'Open the same Guest Matter and choose Create maintenance. The app links the guest report and repair for you.',
      'The repair stays in the Guest Matter’s department. Linking it does not automatically send it to the Maintenance department.',
      'If the details are still open, close them. Then choose Check saved work. Do not create a separate repair for the same problem.',
    ];
    if (session.step === 2) return [
      'Open Maintenance and find the linked repair with the same practice number.',
      'Keep the original department selected. A Maintenance-only login cannot change a Front Desk repair without access to Front Desk.',
      'Open the repair, choose Start work and close the details. Then choose Check saved work.',
    ];
    if (session.step === 3) return [
      'Open the same repair in Maintenance and choose Mark done for this practice.',
      'If the details are still open, close them. Then choose Check saved work. This does not mean a real shower has been repaired.',
    ];
    return [
      'A manager or owner with permission to verify repairs must do this step. A lead or supervisor cannot verify it.',
      'Open the same Done repair. In Verification note, write what was checked. Choose Verify work.',
      'The app also marks the linked Guest Matter Done. Close the details and choose Check saved work to check both entries.',
      'Record a real guest callback separately. This exercise does not check whether anyone called the guest.',
    ];
  }
  if (session.kind === 'guest-ac') {
    return session.step === 0
      ? ['Open Guest Matters and choose New guest matter.', 'Put the practice number in Matter.',
        'Choose Room or Complaint. Think about how soon the guest needs help, then choose the urgency. Choose Solace if it is in the room list.',
        'In the note, describe the AC blowing warm air, the Maintenance check and when Reception will update the guest.',
        'Choose Save matter, then Check saved work.']
      : ['Find the same guest matter in Active.', 'Open it and choose Needs follow-up.',
        'If the details are still open, close them. Then choose Check saved work. Do not mark the AC fixed before it has been checked.'];
  }
  if (session.kind === 'manager-evidence') {
    return session.step === 0
      ? ['Open Requests and choose New request.', 'Put the practice number in Request.',
        'Choose Equipment. Think about how soon the item is needed, then choose the urgency.',
        'In Business reason, write the estimated cost, whether you have a supplier quote and why the item is needed. Use made-up details.',
        'Choose Create draft, then Check saved work. This does not approve a purchase.']
      : ['Open the same Draft request.', 'Check the reason. Do not say a quote is attached when it is missing.',
        'Choose Send for review.', 'If the details are still open, close them. Then choose Check saved work. There should be a Pending Approval for the same request and department. Do not approve it yourself.'];
  }
  if (session.kind === 'shift-unresolved') {
    return session.step === 0
      ? ['Open Shift Handover and choose New handover.', 'Put the practice number in the Title.',
        'Choose Guest. Think about how soon the guest needs an update, then choose the urgency.',
        'In Handover detail, write the problem, who will handle it and when to update the guest.',
        'Choose Publish handover, then Check saved work.']
      : ['Open the same unfinished handover.', 'Choose Carry forward so the next shift knows what still needs doing.',
        'If the details are still open, close them. Then choose Check saved work. Its saved status should be Follow.'];
  }
  if (session.kind === 'mt-light-fault') {
    if (session.step === 0) return ['Open Maintenance and choose Report issue.',
      'Put the practice number in Work item.', 'Think about how soon the light needs attention, choose the urgency and assign a practice technician.',
      'In Problem / scope, say which light is not working and who is affected.', 'Choose Create work item, then Check saved work.'];
    if (session.step === 1) return ['Open the same lighting repair.', 'Choose Start work and wait for Working.', 'If the details are still open, close them. Then choose Check saved work.'];
    if (session.step === 2) return ['After the practice check, choose Mark done.', 'If the details are still open, close them. Then choose Check saved work. A manager still needs to check the result.'];
    return ['Open the same repair in To verify.', 'In Verification note, write what was tested and the result. Use made-up details.',
      'Choose Verify work, then Check saved work. This practice does not prove that a real electrical repair was done.'];
  }
  if (session.step === 0) return [
    'Open Tasks and choose New task.', 'Put the practice number in Task title.',
    'Think about how soon the job needs doing, choose the priority and select someone in Assigned to.',
    'Choose Create task. Check that it appears in the list, then choose Check saved work.',
  ];
  if (session.step === 1) return ['Open the same task in To Do.', 'Choose Start work and wait for Doing.',
    'If the details are still open, close them. Then choose Check saved work.'];
  return ['Open the same Doing task.', 'Choose Submit for review. Someone still needs to check the work.',
    'If the details are still open, close them. Then choose Check saved work. Its saved status should be Review.'];
}
