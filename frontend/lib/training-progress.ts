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
