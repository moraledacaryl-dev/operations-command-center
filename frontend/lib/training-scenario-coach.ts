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
  consequenceDone = true,
): CoachStage {
  const advanced = (scenario.level || 1) >= 3;
  const total = advanced ? 11 : 9;
  const stage = (id: string, title: string, instruction: string, target: string, position: number): CoachStage =>
    ({ id, title, instruction, target, position, total });
  if (phase === 'complete') return stage('complete', 'You passed this lesson!',
    'Your results are saved on this computer. Choose Repeat lesson to try again or Next situation to continue.', '[data-testid="scenario-complete"]', total);
  if (phase === 'assess') {
    if (!reasoningReady && !consequenceDone) return stage('consequence', 'First: What could happen if nobody helps?',
      'Read the story. Tap what could happen if staff do nothing. If the story does not say enough, choose that you are not sure.', '[data-testid="judgment-consequence"]', 2);
    if (!reasoningReady) return stage('timing', 'Next: How soon should staff act?',
      'Think about what could happen if staff wait. Tap how soon you think someone needs to help.', '[data-testid="judgment-timing"]', 3);
    if (!answers.priority || result?.errors.priority) return stage('priority', 'First, choose urgency',
      'Choose Routine, High or Critical based on what happened and how soon staff need to act.', '[data-testid="scenario-priority"]', 4);
    if (!answers.department || result?.errors.department) return stage('department', 'Choose who acts next',
      'Choose the team that can handle this problem.', '[data-testid="scenario-department"]', 5);
    return stage('assessment', 'Check your two choices',
      'Click Check my choices. If an answer needs a change, you can try again.', '[data-testid="scenario-check-assessment"]', 6);
  }
  if (!answers.decision || result?.errors.decision) return stage('decision', 'Choose the action',
    'Choose what the team should do next.', '[data-testid="scenario-decision"]', 7);
  if (advanced && (!answers.owner?.trim() || result?.errors.owner)) return stage('owner', 'Name a responsible role',
    'Write a job title, such as Duty Supervisor. Do not use a real employee name.', '[data-testid="scenario-owner"]', 8);
  if (advanced && (!answers.followUp?.trim() || result?.errors.followUp)) return stage('follow-up', 'Explain the follow-up',
    'Write what should be checked next and who will confirm it.', '[data-testid="scenario-follow-up"]', 9);
  if (answers.note.trim().length < 45 || result?.errors.note) return stage('note', 'Write the handover',
    'Write the practice number, what happened, what happens next, and who will check it.', '[data-testid="scenario-note"]', advanced ? 10 : 8);
  return stage('submit', 'Submit your own response',
    'Click Check my note. If something needs fixing, the app will show you where.', '[data-testid="scenario-submit"]', advanced ? 11 : 9);
}
