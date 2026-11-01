import type { PracticeAnswers, PracticeAssessment, PracticeScenario } from './practice-scenarios';

export type CoachStage = {
  id: string;
  title: string;
  instruction: string;
  target: string;
  position: number;
  total: number;
};

/** Guidance follows a real field state rather than advancing by clicking 'next'
 * without doing the work. Never supplies an answer to the trainee.
 */
export function scenarioCoachStage(
  scenario: PracticeScenario,
  phase: 'assess' | 'document' | 'complete',
  answers: PracticeAnswers,
  result: PracticeAssessment | null,
  reasoningReady = true,
): CoachStage {
  const advanced = (scenario.level || 1) >= 3;
  const total = advanced ? 9 : 7;
  const stage = (id: string, title: string, instruction: string, target: string, position: number): CoachStage =>
    ({ id, title, instruction, target, position, total });
  if (phase === 'complete') return stage('complete', 'You passed this lesson!',
    'Your saved progress stays on this device. Choose Repeat lesson to practice again, or Next situation to continue.', '[data-testid="scenario-complete"]', total);
  if (phase === 'assess') {
    if (!reasoningReady) return stage('reasoning', 'Think through two risk questions first',
      'Tap what is at stake if nobody acts. Then tap how quickly delaying could make it worse. The guide does not give away the correct urgency.', '[data-testid="judgment-lens"]', 1);
    if (!answers.priority || result?.errors.priority) return stage('priority', 'First, choose urgency',
      'You have considered the consequence and timing. Choose the urgency justified by the case facts, not the urgency that merely sounds important.', '[data-testid="scenario-priority"]', 2);
    if (!answers.department || result?.errors.department) return stage('department', 'Choose who acts next',
      'Open this menu and choose the team that should perform the next action. Think about who can actually resolve the issue.', '[data-testid="scenario-department"]', 3);
    return stage('assessment', 'Check your two choices',
      'Click Check my assessment. If anything is incorrect, the lesson will point you back to the answer to reconsider.', '[data-testid="scenario-check-assessment"]', 4);
  }
  if (!answers.decision || result?.errors.decision) return stage('decision', 'Choose the action',
    'Select what the team must do next. The answer is checked when you submit; it is not filled in for you.', '[data-testid="scenario-decision"]', 5);
  if (advanced && (!answers.owner?.trim() || result?.errors.owner)) return stage('owner', 'Name a responsible role',
    'Enter a fictional position such as a duty supervisor. Do not enter a real employee name.', '[data-testid="scenario-owner"]', 6);
  if (advanced && (!answers.followUp?.trim() || result?.errors.followUp)) return stage('follow-up', 'Explain the follow-up',
    'Type what must be checked next and how the result will be confirmed.', '[data-testid="scenario-follow-up"]', 7);
  if (answers.note.trim().length < 45 || result?.errors.note) return stage('note', 'Write the handover',
    'Type a useful fictional note: reference, what happened, next action and follow-up. The lesson checks what you wrote.', '[data-testid="scenario-note"]', advanced ? 8 : 6);
  return stage('submit', 'Submit your own response',
    'Click Submit practice response. If a correction is needed, an error will appear beside the field to revise.', '[data-testid="scenario-submit"]', advanced ? 9 : 7);
}
