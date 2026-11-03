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
    title: 'Open the practice page',
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
    text: 'Open the outlined button, enter made-up details and the practice number, then save. Close the details and choose Check saved work.',
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
    text: 'Find the practice entry containing ' + session.reference +
      '. Open it, choose the button shown above and close the details. Then choose Check saved work to continue.',
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
  const reference = 'Write a clear title that includes the practice number ' + session.reference + '.';
  const title = { selector: first, label: 'Write the practice title', help: reference, minimum: session.reference.length + 8 };
  const field = (number: number, element: 'select' | 'input') =>
    root + ' .form-grid > label:nth-child(' + number + ') ' + element;
  const choice = (number: number, expected: string, label: string, guidance?: string): FieldPrompt =>
    ({ selector: field(number, 'select'), label, help: guidance || 'Choose ' + expected + ' from the menu.', expected });
  const note = (label: string): FieldPrompt => ({
    selector: root + ' label textarea', label,
    help: 'Write what happened, who should act next and what they need to check. Do not write only “done.”', minimum: 35,
  });
  if (type === 'task') return [
    title, choice(3, 'High', 'Decide the task priority', 'A task with nobody assigned may be missed. Think about what could happen if staff wait, and whether anyone is in danger.'),
    { selector: field(4, 'select'), label: 'Choose who will do the job',
      help: 'Choose someone from Assigned to. Do not leave it Unassigned.', expected: '!empty' },
  ];
  if (type === 'shift') return [
    title, choice(3, 'Guest', 'Choose Guest category'), choice(4, 'Urgent', 'Decide how urgent the handover is', 'The guest is waiting and nobody has been asked to call back. Think about whether the next shift needs to act soon.'),
    note('Write what the next shift needs to do'),
  ];
  if (type === 'request') return [
    title, choice(2, 'Equipment', 'Choose Equipment type'), choice(3, 'Urgent', 'Decide the request urgency', 'The team needs equipment, but the price and supplier quote still need checking. Think about how soon the team needs an answer.'),
    note('Write the cost, quote details and reason'),
  ];
  if (type === 'fix') return [
    title, choice(3, 'High', 'Assess the failed light', 'Think about who uses this corridor and how soon a qualified person should check the light. Do not assume it is fixed.'),
    { selector: field(4, 'select'), label: 'Choose a practice technician',
      help: 'Select the technician responsible for this practice fault.', expected: '!empty' },
    note('Describe the failed corridor light and impact'),
  ];
  return [
    title,
    { selector: field(4, 'select'), label: 'Choose Room or Complaint type',
      help: 'Choose Room or Complaint to describe this guest problem.', expected: 'Room|Complaint' },
    choice(5, 'High', 'Assess the guest matter', 'The guest’s room has a problem that has not been checked. Think about what could happen if staff wait, and when the guest needs an update.'),
    note('Write the problem, next check and guest update'),
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
      title: 'Saved. Check your work',
      text: 'Your practice entry appears in the list. Choose Check saved work to continue.',
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
      text: 'Fill in this field with made-up details, then save.',
      targets: [{ selector: root }] };
    const value = control.value.trim();
    const passed = prompt.expected === '!empty' ? value.length > 0
      : prompt.expected?.includes('|') ? prompt.expected.split('|').includes(value)
      : prompt.expected ? value === prompt.expected
      : prompt.selector === root + ' .form-grid > label:nth-child(1) input'
        ? value.includes(session.reference) && value.length >= (prompt.minimum || 0)
        : value.length >= (prompt.minimum || 0);
    if (!passed) return { title: prompt.label,
      text: prompt.help + ' The arrow moves when you fill in this field.',
      targets: [{ selector: prompt.selector }] };
  }
  return { title: 'Save your practice entry',
    text: 'Choose the outlined Save, Create or Publish button. Then choose Check saved work. Typing into the form does not save it.',
    targets: [{ selector: root + ' .toolbar button:not(.secondary)' }] };
}
