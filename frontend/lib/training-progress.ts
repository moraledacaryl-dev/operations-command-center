import { DECISIONS, DEPARTMENTS, PRIORITIES } from './practice-scenarios';
import type { PracticeAnswers } from './practice-scenarios';

/** Validate untrusted device-local progress before counting completed cases.
 * This protects against storage corruption, not intentional result forgery;
 * scenario drills are not a signed certification.
 */
export type ScenarioProgressRecord = {
  attempts: number;
  completedAt: string;
  hints?: number;
  mistakes?: number;
  firstTry?: boolean;
  /** Validated trainee's answer, not official proof or an Operations record. */
  response?: PracticeAnswers;
};
export type ScenarioProgress = Record<string, ScenarioProgressRecord>;

export function parseScenarioProgress(raw: unknown, allowedScenarioIds: readonly string[]): ScenarioProgress {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const saved = raw as Record<string, unknown>;
  const safe: ScenarioProgress = {};
  for (const id of allowedScenarioIds) {
    const value = saved[id];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const attempts = item.attempts;
    const hints = item.hints ?? 0;
    const mistakes = item.mistakes ?? 0;
    if (typeof item.completedAt !== 'string' || !Number.isFinite(Date.parse(item.completedAt)) ||
        typeof attempts !== 'number' || !Number.isSafeInteger(attempts) || attempts < 1 ||
        typeof hints !== 'number' || !Number.isSafeInteger(hints) || hints < 0 ||
        typeof mistakes !== 'number' || !Number.isSafeInteger(mistakes) || mistakes < 0 ||
        mistakes > attempts || hints > 10000 ||
        (item.firstTry !== undefined && typeof item.firstTry !== 'boolean')) continue;
    // Old progress may not include the optional firstTry field. Never
    // advertise unassisted if any earlier corrections or hints are recorded.
    let response: PracticeAnswers | undefined;
    if (item.response && typeof item.response === 'object' && !Array.isArray(item.response)) {
      const a = item.response as Record<string, unknown>;
      if (PRIORITIES.includes(a.priority as never) && DEPARTMENTS.includes(a.department as never)
        && DECISIONS.includes(a.decision as never)
        && typeof a.note === 'string' && a.note.length <= 4000
        && (a.owner === undefined || (typeof a.owner === 'string' && a.owner.length <= 200))
        && (a.followUp === undefined || (typeof a.followUp === 'string' && a.followUp.length <= 1500))) {
        response = a as PracticeAnswers;
      }
    }
    safe[id] = { ...(response ? { response } : {}), attempts, completedAt: item.completedAt, hints, mistakes,
      firstTry: item.firstTry === true && mistakes === 0 && hints === 0 };
  }
  return safe;
}

import { WORKFLOW_DEFINITIONS, WORKFLOW_REFERENCE_PREFIXES, isTrainingWorkflowKind } from './training-workflows';
import type { TrainingWorkflowResults } from './training-workflows';

/** Ignore malformed device-local workflow summaries in progress totals/CSV.
 * This is not proof of who performed the workflow; authorization and actual
 * record transitions are checked by the Operations backend during practice.
 */
export function parseWorkflowResults(raw: unknown): TrainingWorkflowResults {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const saved = raw as Record<string, unknown>;
  const safe: TrainingWorkflowResults = {};
  for (const [key, value] of Object.entries(saved)) {
    if (!isTrainingWorkflowKind(key) ||
        !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const stages = WORKFLOW_DEFINITIONS[key].stages;
    const prefix = WORKFLOW_REFERENCE_PREFIXES[key];
    if (typeof item.reference !== 'string' || !item.reference.startsWith(prefix) ||
        typeof item.completedAt !== 'string' || !Number.isFinite(Date.parse(item.completedAt)) ||
        typeof item.recordId !== 'number' || !Number.isSafeInteger(item.recordId) || item.recordId <= 0 ||
        (item.relatedRecordId !== undefined && (typeof item.relatedRecordId !== 'number' ||
          !Number.isSafeInteger(item.relatedRecordId) || item.relatedRecordId <= 0)) ||
        !Array.isArray(item.steps) || item.steps.length !== stages.length ||
        !stages.every((stage, index) => item.steps[index] === stage)) continue;
    const linkedId = typeof item.relatedRecordId === 'number' ? item.relatedRecordId : undefined;
    safe[key] = { reference: item.reference, completedAt: item.completedAt,
      recordId: item.recordId, steps: [...stages],
      ...(linkedId ? { relatedRecordId: linkedId } : {}) };
  }
  return safe;
}
