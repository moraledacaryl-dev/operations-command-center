import { SCENARIO_PROGRESS_PREFIX, parseScenarioProgress } from './training-progress';
import { DRAFT_PREFIX, parseScenarioDrafts } from './training-scenario-drafts';
import type { PracticeScenario } from './practice-scenarios';

function readObject(storage: Storage, key: string): Record<string, unknown> {
  const raw = storage.getItem(key);
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid local progress');
  return value as Record<string, unknown>;
}
function validScenarioSections(completed: unknown, drafts: unknown, available: readonly PracticeScenario[]) {
  if (!completed || typeof completed !== 'object' || Array.isArray(completed) ||
      !drafts || typeof drafts !== 'object' || Array.isArray(drafts)) throw Error('Invalid scenario history');
  const safeCompleted = parseScenarioProgress(completed, available.map(s => s.id));
  const safeDrafts = parseScenarioDrafts(drafts, available);
  for (const {id} of available) {
    if ((Object.prototype.hasOwnProperty.call(completed, id) && !Object.prototype.hasOwnProperty.call(safeCompleted, id)) ||
        (Object.prototype.hasOwnProperty.call(drafts, id) && !Object.prototype.hasOwnProperty.call(safeDrafts, id))) {
      throw Error('Invalid scenario history');
    }
  }
  return { completed: safeCompleted, drafts: safeDrafts };
}
export function readScenarioBackup(storage: Storage, identity: string, available: readonly PracticeScenario[]) {
  return validScenarioSections(readObject(storage, SCENARIO_PROGRESS_PREFIX + identity),
    readObject(storage, DRAFT_PREFIX + identity), available);
}

/** Destination data always wins. Import never overwrites an existing attempt or draft. */
export function mergeScenarioBackup(storage: Storage, identity: string, available: readonly PracticeScenario[],
  backup: { completed: unknown; drafts: unknown }): void {
  const progressKey = SCENARIO_PROGRESS_PREFIX + identity, draftKey = DRAFT_PREFIX + identity;
  const existingProgress = readObject(storage, progressKey), existingDrafts = readObject(storage, draftKey);
  const {completed, drafts} = validScenarioSections(backup.completed, backup.drafts, available);
  const updates: [string, string][] = [
    [progressKey, JSON.stringify({ ...completed, ...existingProgress })],
    [draftKey, JSON.stringify({ ...drafts, ...existingDrafts })],
  ];
  const previous = updates.map(([key]) => [key, storage.getItem(key)] as const);
  try {
    for (const [key, value] of updates) storage.setItem(key, value);
  } catch (error) {
    for (const [key, value] of previous) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* storage unavailable */ }
    }
    throw error;
  }
}
