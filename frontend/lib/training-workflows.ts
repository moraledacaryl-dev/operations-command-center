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
  'shift-unresolved': {
    name: 'Record and carry forward a shift handover',
    path: '/shift',
    resource: 'shift-notes',
    stages: ['Publish a usable handover', 'Carry the unresolved matter forward'],
  },
  'mt-light-fault': {
    name: 'Maintain and verify a hallway lighting work order',
    path: '/fixes',
    resource: 'fixes',
    stages: ['Report and assign the maintenance issue', 'Start the work order', 'Mark the work ready for verification', 'Verify the finished work'],
  },
  'manager-evidence': {
    name: 'Prepare and submit a documented purchase request',
    path: '/requests',
    resource: 'requests',
    stages: ['Create a defensible equipment request', 'Submit for authorized review'],
  },
  'fd-broken-shower': {
    name: 'Guest report linked to same-department maintenance work',
    path: '/guests',
    resource: 'guests',
    stages: ['Log the shower issue with guest follow-up', 'Create the linked maintenance work order',
      'Start linked maintenance', 'Record maintenance as done', 'Verify work and auto-close the guest case'],
  },
} as const;

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
        ? 'A matching case exists, but its saved record must have High urgency, Room or Complaint type, and a note describing the AC fault, Maintenance action, and guest follow-up. Correct the case according to authorized controls, or create a corrected fictional one with the same reference.'
        : session.kind === 'fd-broken-shower'
          ? 'The saved guest report must have High urgency, Room or Complaint type, and a note about the faulty shower, maintenance inspection, and Front Desk guest callback.'
        : session.kind === 'shared-no-owner'
          ? 'A matching task exists, but its saved record must be High priority and have an actual assigned person. Open the task, edit it, and save those fields.'
          : session.kind === 'shift-unresolved'
            ? 'Your published handover must use Urgent priority, Guest category, and specify the guest concern, a responsible follow-up owner, and the next guest update.'
            : session.kind === 'manager-evidence'
              ? 'The saved request must use Equipment type, Urgent priority, and a business reason documenting quotation status, cost/budget and the operational justification. Never invent an attached quotation.'
              : 'Your maintenance report must use High urgency, name a fictional technician, and describe the failed corridor lighting in Problem / scope.'
      : 'No saved record with your unique training reference was found yet. Open the correct module, use the actual New button, fill in the details, and save before checking again.' };
  }
  if (!session.recordId || !detail || positiveId(detail.id) !== session.recordId ||
    !readable(detail.title).includes(session.reference.toLowerCase())) {
    return { passed: false, error: 'The original training record could not be verified. Refresh the correct record and retry; do not create a different unlinked case.' };
  }
  const status = readable(detail.status);
  if (session.kind === 'fd-broken-shower') {
    const linkedId = positiveId(detail.linked_fix_id);
    if (!linkedId || !relatedDetail ||
      positiveId(relatedDetail.id) !== linkedId ||
      positiveId(relatedDetail.linked_guest_note_id) !== session.recordId ||
      !readable(relatedDetail.title).includes(session.reference.toLowerCase())) {
      return { passed: false, error: 'The original Guest Matter is not yet linked to a reciprocal Maintenance work order. Open the Guest Matter and select Create maintenance. An unrelated ticket does not count.' };
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
          ? 'The linked work order is not Done. Mark the fictional maintenance work ready for independent verification first.'
          : 'The original linked Maintenance work order needs a verification note and Verified status in the training database.' };
    }
    return { passed: true, error: '', recordId: session.recordId, relatedRecordId: linkedId,
      stepName: definition.stages[session.step] };
  }
  if (session.kind === 'guest-ac') {
    return status === 'follow'
      ? { passed: true, error: '', recordId: session.recordId, stepName: definition.stages[1] }
      : { passed: false, error: 'The saved guest matter is not in Needs follow-up yet. Open the original matter, choose Needs follow-up, and save that real status transition.' };
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
            ? 'Complete the actual fictional repair workflow with Mark done, but do not claim real building work is finished.'
            : 'Open the original Done item and provide a verification note before clicking Verify work. A status change alone cannot substitute for a genuine real-world inspection.' };
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
      'Open Guest Matters. Select New guest matter and place the unique training reference in Matter title.',
      'Choose Room or Complaint and High urgency. Describe a shower without hot water, the Maintenance inspection, and the Front Desk guest callback in the context note.',
      'Click Save matter. Close any details drawer, then Check saved work.',
    ];
    if (session.step === 1) return [
      'Open the original Guest Matter by its reference, select Create maintenance, and let Operations link the records automatically. The current UI creates the Fix in the Guest Matter’s department; it does NOT automatically transfer it to the Maintenance department.',
      'Close the details drawer. Select Check saved work to verify BOTH saved links and the guest follow-up status. Do not create a second, unrelated work order.',
    ];
    if (session.step === 2) return [
      'Open Maintenance. The linked work order has the same reference as the Guest Matter and remains in its originating department unless an authorized handoff is arranged separately.',
      'Select the original reporting department in the Operations workspace selector if authorized. A Maintenance-only staff account cannot act on a Front Desk work order without department access.',
      'Open that exact ticket, click Start work and close the drawer. Then Check saved work.',
    ];
    if (session.step === 3) return [
      'In Maintenance, reopen the linked ticket and choose Mark done for this entirely fictional repair.',
      'Close details and Check saved work. This does not prove any physical shower was repaired.',
    ];
    return [
      'A Management/Owner account with decision authority must perform the final verification. The server will reject verification from a Supervisor or Lead.',
      'Open that same Done maintenance ticket. In Verification note describe the fictional inspection, and select Verify work.',
      'The REAL backend automatically marks the linked Guest Matter Done when the Fix is Verified. Close details, then Check saved work to verify BOTH saved statuses.',
      'Any actual guest callback must be documented separately; this exercise does not independently prove guest communication.',
    ];
  }
  if (session.kind === 'guest-ac') {
    return session.step === 0
      ? ['Open Guest Matters and click New guest matter.', 'Include the exact training reference in the Matter title.', 'Select Room or Complaint, choose High urgency, and use Room 205 if it appears in the fictional room list.', 'In the context note, describe the AC blowing warm air, the Maintenance inspection request, and when Front Desk will update the guest.', 'Click Save matter. Only then click Check saved work.']
      : ['Find the saved matter with your reference in the Active list.', 'Open it, choose Needs follow-up, and confirm the updated record.', 'Click Check saved work to verify the saved status. Do not resolve an uninspected AC fault.'];
  }
  if (session.kind === 'manager-evidence') {
    return session.step === 0
      ? ['Open Requests and click New request.', 'Include the unique training reference in Request title.',
        'Choose Equipment type and Urgent priority.', 'In Business reason, explain the fictional estimated amount, quotation status (if missing, say so), and why the item is operationally needed.',
        'Click Create draft, then Check saved work. This is not an authorized purchase or approval.']
      : ['Locate the same saved Draft request and open it.', 'Check that the reason is accurate and does not claim a quotation is attached when it is not.',
        'Choose Send for review.', 'Close details, then Check saved work. The app must create a Pending Approval tied to the same request and department. Do NOT self-approve.'];
  }
  if (session.kind === 'shift-unresolved') {
    return session.step === 0
      ? ['Open Shift Handover and click New handover.', 'Add the unique reference to the Title.',
        'Choose Guest category and Urgent priority.', 'In Handover detail, describe the unresolved guest concern, the responsible owner, and the guest update or follow-up needed.',
        'Publish handover, then Check saved work.']
      : ['Open the original unresolved handover in the list.', 'Choose Carry forward to leave an actionable follow-up for the next shift.',
        'Check saved work to prove that its persisted status is Follow.'];
  }
  if (session.kind === 'mt-light-fault') {
    if (session.step === 0) return ['Open Maintenance and click Report issue.',
      'Include your unique training reference in Work item.', 'Set urgency to High and choose a fictional assigned technician.',
      'Describe the nonfunctioning corridor light and its impact in Problem / scope.', 'Click Create work item, then Check saved work.'];
    if (session.step === 1) return ['Find and open the saved lighting work item.', 'Click Start work; wait for its status to become Working.', 'Click Check saved work.'];
    if (session.step === 2) return ['For this synthetic repair only, click Mark done after the practice inspection.', 'Check saved work to prove the record is ready for verification.'];
    return ['Reopen the saved work order in the To verify column.', 'Enter a meaningful fictional verification note explaining what was tested.',
      'Click Verify work, then Check saved work. Never use these training steps as evidence of an actual electrical repair.'];
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
