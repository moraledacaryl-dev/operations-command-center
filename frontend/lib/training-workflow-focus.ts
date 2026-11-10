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
  if (session.kind === 'bar-report') return onModule ? {
    title: 'Save a practice Bar report',
    text: 'Select Report a problem. Put the practice number in the title, explain the low mocktail syrup, and save. Then choose Check saved work.',
    targets: [ { selector: '[data-testid="bar-open-report"]' }, { selector: '[data-testid="bar-report-form"]' }, { selector: '[data-testid="training-check-work"]' } ],
  } : {
    title: 'Open Bar practice', text: 'Select Open to go to Bar, then follow the next step.',
    targets: [{ selector: '[data-testid="training-open-module"]' }],
  };
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
    text: 'Open the highlighted form. Add made-up details and your practice number, then save and choose Check saved work.',
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
      '. Open it, complete the indicated action and close its details. Choose Check saved work to continue.',
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
  const reference = 'Write a clear title that includes ' + session.reference + '.';
  const title = { selector: first, label: 'Write a title', help: reference, minimum: session.reference.length + 8 };
  const field = (number: number, element: 'select' | 'input') =>
    root + ' .form-grid > label:nth-child(' + number + ') ' + element;
  const choice = (number: number, expected: string, label: string, guidance?: string): FieldPrompt =>
    ({ selector: field(number, 'select'), label, help: guidance || 'Choose ' + expected + ' from the menu.', expected });
  const note = (label: string): FieldPrompt => ({
    selector: root + ' label textarea', label,
    help: 'Explain what needs doing, who will handle it and when to check again.', minimum: 35,
  });
  if (type === 'task') return [
    title, choice(3, 'High', 'Decide the task priority', 'Think about how soon this task needs doing and what could happen if it is delayed.'),
    { selector: field(4, 'select'), label: 'Assign a practice teammate',
      help: 'Choose a fictional teammate from Assigned to. Do not leave this as Unassigned.', expected: '!empty' },
  ];
  if (type === 'shift') return [
    title, choice(3, 'Guest', 'Choose Guest category'), choice(4, 'Urgent', 'Decide how urgent the handover is', 'The guest is waiting for an update. Decide how soon the next shift needs to act.'),
    note('Write the shift note'),
  ];
  if (type === 'request') return [
    title, choice(2, 'Equipment', 'Choose Equipment type'), choice(3, 'Urgent', 'Decide the request urgency', 'Think about how soon the equipment is needed. The reviewer still needs to check the cost and quote.'),
    note('Explain the cost, quote and reason for the request'),
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
      help: 'Choose Room or Complaint for this issue.', expected: 'Room|Complaint' },
    choice(5, 'High', 'Assess the guest matter', 'Think about how the room problem affects the guest and how soon it needs checking.'),
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
  if (session.kind === 'bar-report') {
    if (!onModule || session.step !== 0) return basic;
    const form = document.querySelector('[data-testid="bar-report-form"]');
    if (!form) {
      if (Array.from(document.querySelectorAll('[data-testid="bar-reports"] button'))
        .some(card => card.textContent?.includes(session.reference))) {
        return {
          title: 'Check your saved Bar report',
          text: 'The report with your practice number appears in Bar. Select Check saved work to confirm it was saved.',
          targets: [{ selector: '[data-testid="training-check-work"]' }],
        };
      }
      return {
        title: 'Open the Bar report form',
        text: 'Select Report a problem to begin the fictional low-stock handover.',
        targets: [{ selector: '[data-testid="bar-open-report"]' }],
      };
    }
    const title = form.querySelector<HTMLInputElement>('input[placeholder="Example: Mocktail blender stopped working"]');
    if (!title?.value.includes(session.reference)) return {
      title: 'Write what happened',
      text: 'Include your practice number ' + session.reference + ' and a clear title such as "Mocktail syrup low".',
      targets: [{ selector: '[data-testid="bar-report-form"] input[placeholder="Example: Mocktail blender stopped working"]' }],
    };
    const kind = form.querySelector<HTMLSelectElement>('select');
    if (kind?.value !== 'Low stock') return {
      title: 'Choose the report type',
      text: 'This exercise is about nearly empty mocktail syrup. Select Low stock, not Equipment or Other.',
      targets: [{ selector: '[data-testid="bar-report-form"] select' }],
    };
    const details = form.querySelector<HTMLTextAreaElement>('textarea');
    const words = (details?.value || '').toLowerCase();
    if (!/syrup|mocktail/.test(words) || !/count|check/.test(words) ||
        !/next shift|next bartender/.test(words)) return {
      title: 'Explain what the next bartender should do',
      text: 'Mention the low mocktail syrup, counting or checking the stock, and the next shift. Write your own sentence.',
      targets: [{ selector: '[data-testid="bar-report-form"] textarea' }],
    };
    return {
      title: 'Save the Bar report',
      text: 'Select Save Bar report. Then use Check saved work; the system will verify the saved fictional record.',
      targets: [{ selector: '[data-testid="bar-save-report"]' }],
    };
  }
  if (!onModule || session.step !== 0) return basic;
  const type = ({ 'guest-ac': 'guest', 'shared-no-owner': 'task', 'shift-unresolved': 'shift',
    'mt-light-fault': 'fix', 'manager-evidence': 'request', 'fd-broken-shower': 'guest' } as const)[session.kind];
  const root = '[data-testid="create-' + type + '-form"]';
  const form = document.querySelector(root);
  if (!form) {
    if (savedTrainingCard(session)) return {
      title: 'Check your saved work',
      text: 'Your practice number appears in the list. Choose Check saved work to continue.',
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
  return { title: 'Save your practice',
    text: 'Choose the highlighted Save, Create or Publish button, then Check saved work.',
    targets: [{ selector: root + ' .toolbar button:not(.secondary)' }] };
}
