import type { TrainingWorkflowSession } from './training-workflows';
import type { FocusTarget } from '@/components/TrainingSpotlight';

type WorkflowFocus = {
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
