import type { TrainingWorkflowSession } from './training-workflows';
import type { FocusTarget } from '@/components/TrainingSpotlight';

export type WorkflowFocus = {
  title: string;
  text: string;
  targets: FocusTarget[];
};

/** Same field/button names as the actual training-only Operations screens.
 * Only the real backend verifier, never the spotlight, advances a stage.
 */
export function workflowFocus(session: TrainingWorkflowSession, onModule: boolean): WorkflowFocus {
  if (!onModule) return {
    title: 'Open the correct Operations screen',
    text: 'Click the outlined Open button. The guided lesson stays with you when the page changes.',
    targets: [{ selector: '[data-testid="training-open-module"]' }],
  };
  const type = session.kind === 'fd-broken-shower' ? (session.step >= 2 ? 'fixes' : 'guests') :
    ({ 'guest-ac': 'guests', 'shared-no-owner': 'tasks', 'shift-unresolved': 'shift',
      'mt-light-fault': 'fixes', 'manager-evidence': 'requests' } as const)[session.kind];
  const create = ({ guests: 'guest', tasks: 'task', shift: 'shift',
    fixes: 'fix', requests: 'request' } as const)[type];
  if (session.step === 0) return {
    title: 'Click New, fill in the form and save',
    text: 'The orange outline points to the actual screen control. Open the form, enter fictional details and your unique reference, then save. Return to the coach and click Check saved work.',
    targets: [
      { selector: '[data-testid="create-' + create + '-form"]' },
      { selector: '[data-testid="create-' + create + '"]' },
      { selector: '[data-testid="training-check-work"]' },
    ],
  };
  const action = (() => {
    if (session.kind === 'guest-ac') return 'Needs follow-up';
    if (session.kind === 'shift-unresolved') return 'Carry forward';
    if (session.kind === 'manager-evidence') return 'Send for review';
    if (session.kind === 'fd-broken-shower') return [
      '', 'Create maintenance', 'Start work', 'Mark done', 'Verify work',
    ][session.step] || 'Check saved work';
    if (session.kind === 'mt-light-fault') return ['', 'Start work', 'Mark done', 'Verify work'][session.step] || 'Check saved work';
    return session.step === 1 ? 'Start work' : 'Submit for review';
  })();
  return {
    title: 'Open the saved record and click ' + action,
    text: 'Find the fictional record containing ' + session.reference +
      '. Open it, complete the indicated action and close its details. The next stage unlocks only after Check saved work confirms the database change.',
    targets: [
      { selector: '.drawer-backdrop button', containsText: action },
      { selector: '.maintenance-board-card', containsText: session.reference },
      { selector: '.ops-handover-card', containsText: session.reference },
      { selector: '[data-testid="tasks-board"] button', containsText: session.reference },
      { selector: '[data-testid="tasks-list"] button', containsText: session.reference },
      { selector: '.ops-card-grid button', containsText: session.reference },
      { selector: '[data-testid="training-check-work"]' },
    ],
  };
}


type FieldPrompt = { selector: string; label: string; help: string; expected?: string; minimum?: number };

function getFormPrompts(session: TrainingWorkflowSession, type: string): FieldPrompt[] {
  const root = '[data-testid="create-' + type + '-form"]';
  const first = root + ' .form-grid > label:nth-child(1) input';
  const reference = 'Write a descriptive fictional title that includes ' + session.reference + '.';
  const title = { selector: first, label: 'Type the training record title', help: reference, minimum: session.reference.length + 8 };
  const field = (number: number, element: 'select' | 'input') =>
    root + ' .form-grid > label:nth-child(' + number + ') ' + element;
  const choice = (number: number, expected: string, label: string, guidance?: string): FieldPrompt =>
    ({ selector: field(number, 'select'), label, help: guidance || 'Choose ' + expected + ' in this real menu.', expected });
  const note = (label: string): FieldPrompt => ({
    selector: root + ' label textarea', label,
    help: 'Write concrete fictional actions, ownership and follow-up, not only “done.”', minimum: 35,
  });
  if (type === 'task') return [
    title, choice(3, 'High', 'Decide the task priority', 'An unassigned task needs clear ownership. Think about the consequence of delay, whether immediate danger is reported, and how quickly the issue needs action.'),
    { selector: field(4, 'select'), label: 'Assign an actual fictional teammate',
      help: 'Choose a fictional teammate from Assigned to. Do not leave this as Unassigned.', expected: '!empty' },
  ];
  if (type === 'shift') return [
    title, choice(3, 'Guest', 'Choose Guest category'), choice(4, 'Urgent', 'Decide how urgent the handover is', 'The guest has no update and nobody owns the follow-up. Think about whether this can wait in the normal queue or needs timely shift coordination.'),
    note('Write the actionable shift handover'),
  ];
  if (type === 'request') return [
    title, choice(2, 'Equipment', 'Choose Equipment type'), choice(3, 'Urgent', 'Decide the request urgency', 'The equipment need deserves a timely review, but price and quotation still need verification. Decide urgency from impact and timing, not from pressure to approve.'),
    note('Document budget, quotation status and operational reason'),
  ];
  if (type === 'fix') return [
    title, choice(3, 'High', 'Assess the failed light', 'Think about how this fault could affect people using the corridor and how soon it requires a qualified inspection. Do not assume a repair is complete.'),
    { selector: field(4, 'select'), label: 'Assign a fictional technician',
      help: 'Select the technician responsible for this practice fault.', expected: '!empty' },
    note('Describe the failed corridor light and impact'),
  ];
  return [
    title,
    { selector: field(4, 'select'), label: 'Choose Room or Complaint type',
      help: 'This guest matter must be classified as a Room issue or Complaint.', expected: 'Room|Complaint' },
    choice(5, 'High', 'Assess the guest matter', 'The guest is affected by an unresolved room fault. Consider the cost of waiting for inspection and the next guest update; distinguish significant disruption from confirmed immediate danger.'),
    note('Describe the fault, required inspection and guest callback'),
  ];
}

function savedTrainingCard(session: TrainingWorkflowSession): boolean {
  const cards = document.querySelectorAll(
    '.maintenance-board-card, .ops-handover-card, [data-testid="tasks-board"] button, ' +
    '[data-testid="tasks-list"] button, .ops-card-grid button');
  return Array.from(cards).some(card => card.textContent?.includes(session.reference));
}

/** Called only inside a client effect. Maps the real form and current user input
 * to a precise next focus. This visual hint NEVER marks a database stage complete.
 */
export function currentWorkflowFocus(session: TrainingWorkflowSession, onModule: boolean): WorkflowFocus {
  const basic = workflowFocus(session, onModule);
  if (!onModule || session.step !== 0) return basic;
  const type = ({ 'guest-ac': 'guest', 'shared-no-owner': 'task', 'shift-unresolved': 'shift',
    'mt-light-fault': 'fix', 'manager-evidence': 'request', 'fd-broken-shower': 'guest' } as const)[session.kind];
  const root = '[data-testid="create-' + type + '-form"]';
  const form = document.querySelector(root);
  if (!form) {
    if (savedTrainingCard(session)) return {
      title: 'Saved! Verify your practice record',
      text: 'Your training reference is visible in the saved list. Click Check saved work to verify the record and unlock the next step.',
      targets: [{ selector: '[data-testid="training-check-work"]' }],
    };
    return basic;
  }
  for (const prompt of getFormPrompts(session, type)) {
    const control = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      prompt.selector.replace(root + ' ', ''),
    );
    // If a particular form differs, focus the form rather than silently giving
    // a false visual completion.
    if (!control) return { title: 'Complete the highlighted form',
      text: 'Find the matching labeled field inside this form, enter the fictional details, and save.',
      targets: [{ selector: root }] };
    const value = control.value.trim();
    const passed = prompt.expected === '!empty' ? value.length > 0
      : prompt.expected?.includes('|') ? prompt.expected.split('|').includes(value)
      : prompt.expected ? value === prompt.expected
      : prompt.selector === root + ' .form-grid > label:nth-child(1) input'
        ? value.includes(session.reference) && value.length >= (prompt.minimum || 0)
        : value.length >= (prompt.minimum || 0);
    if (!passed) return { title: prompt.label,
      text: prompt.help + ' After completing this field, the orange arrow moves automatically.',
      targets: [{ selector: prompt.selector }] };
  }
  return { title: 'Now save the fictional record',
    text: 'Click the outlined Save/Create/Publish button. Then use Check saved work in the coach. Merely typing into the form does not finish the stage.',
    targets: [{ selector: root + ' .toolbar button:not(.secondary)' }] };
}
