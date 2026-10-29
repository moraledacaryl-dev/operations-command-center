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
};
export type ScenarioProgress = Record<string, ScenarioProgressRecord>;

export function parseScenarioProgress(raw: unknown, allowedScenarioIds: readonly string[]): ScenarioProgress {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const allowed = new Set(allowedScenarioIds);
  const saved = raw as Record<string, unknown>;
  const safe: ScenarioProgress = {};
  for (const id of allowed) {
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
        mistakes > attempts || hints > attempts ||
        (item.firstTry !== undefined && typeof item.firstTry !== 'boolean')) continue;
    // Old progress may not include the optional firstTry field. Never
    // advertise unassisted if any earlier corrections or hints are recorded.
    safe[id] = { attempts, completedAt: item.completedAt, hints, mistakes,
      firstTry: item.firstTry === true && mistakes === 0 && hints === 0 };
  }
  return safe;
}

import { WORKFLOW_DEFINITIONS, isTrainingWorkflowKind } from './training-workflows';
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
    const prefix = ({
      'guest-ac': 'TRN-GUEST-', 'shared-no-owner': 'TRN-TASK-',
      'shift-unresolved': 'TRN-SHIFT-', 'mt-light-fault': 'TRN-FIX-',
      'manager-evidence': 'TRN-REQ-', 'fd-broken-shower': 'TRN-LINK-',
    })[key];
    if (typeof item.reference !== 'string' || !item.reference.startsWith(prefix) ||
        typeof item.completedAt !== 'string' || !Number.isFinite(Date.parse(item.completedAt)) ||
        typeof item.recordId !== 'number' || !Number.isSafeInteger(item.recordId) || item.recordId <= 0 ||
        (item.relatedRecordId !== undefined && (typeof item.relatedRecordId !== 'number' ||
          !Number.isSafeInteger(item.relatedRecordId) || item.relatedRecordId <= 0)) ||
        !Array.isArray(item.steps) || item.steps.length !== stages.length ||
        !stages.every((stage, index) => item.steps[index] === stage)) continue;
    safe[key] = { reference: item.reference, completedAt: item.completedAt,
      recordId: item.recordId, steps: [...stages],
      ...(item.relatedRecordId ? { relatedRecordId: item.relatedRecordId } : {}) };
  }
  return safe;
}
