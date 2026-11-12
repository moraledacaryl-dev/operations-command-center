import { assessPractice, DECISIONS, DEPARTMENTS, PRIORITIES } from './practice-scenarios';
import type { PracticeAnswers, PracticeScenario } from './practice-scenarios';

export type ScenarioDraft = {
  answers: PracticeAnswers;
  phase: 'assess' | 'document' | 'complete';
  attempts: number;
  hintsUsed: number;
  mistakesMade: number;
  reasoning: { consequence: string; timing: string };
};
export type ScenarioDrafts = Record<string, ScenarioDraft>;
export const DRAFT_PREFIX = 'ho-ops-scenario-drafts-v1:';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Drafts preserve effort, never award completion. Validate before restoring a stage. */
export function parseScenarioDrafts(raw: unknown, scenarios: readonly PracticeScenario[]): ScenarioDrafts {
  if (!isRecord(raw)) return {};
  const safe: ScenarioDrafts = {};
  for (const scenario of scenarios) {
    const draft = raw[scenario.id];
    if (!isRecord(draft) || !isRecord(draft.answers) || !isRecord(draft.reasoning)) continue;
    const a = draft.answers;
    if (![...PRIORITIES, ''].includes(a.priority as never) || ![...DEPARTMENTS, ''].includes(a.department as never)
      || ![...DECISIONS, ''].includes(a.decision as never) || typeof a.note !== 'string' || a.note.length > 4000
      || typeof a.owner !== 'string' || a.owner.length > 200 || typeof a.followUp !== 'string' || a.followUp.length > 1500
      || typeof draft.reasoning.consequence !== 'string' || draft.reasoning.consequence.length > 200
      || typeof draft.reasoning.timing !== 'string' || draft.reasoning.timing.length > 200
      || !['assess', 'document', 'complete'].includes(String(draft.phase))
      || ![draft.attempts, draft.hintsUsed, draft.mistakesMade].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
      || Number(draft.mistakesMade) > Number(draft.attempts)) continue;
    const answers = a as PracticeAnswers;
    const phase = draft.phase === 'complete' && assessPractice(scenario, answers).passed ? 'complete'
      : draft.phase !== 'assess' && answers.priority === scenario.priority && answers.department === scenario.route ? 'document' : 'assess';
    safe[scenario.id] = { answers, phase, attempts: Number(draft.attempts), hintsUsed: Number(draft.hintsUsed),
      mistakesMade: Number(draft.mistakesMade), reasoning: draft.reasoning as ScenarioDraft['reasoning'] };
  }
  return safe;
}
