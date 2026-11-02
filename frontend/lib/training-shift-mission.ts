/** Shared read-only handover task for staff in every resort department.
 * The room names may be real, but all guest and work records are invented.
 */
export const SHIFT_MISSION_PREFIX = 'ho-training-shift-mission-v1:';
export const SHIFT_PRACTICE_EVENT = 'ho-training-shift-action';
export const SHIFT_PRACTICE_FINISHED = 'ho-training-shift-finished';
export type ShiftMissionStage = 'intro' | 'filter' | 'open' | 'answer' | 'solo-open' | 'solo-answer';
export type ShiftMissionProgress = { stage: ShiftMissionStage; firstId?: number; secondId?: number };
export type ShiftPracticeAction = { kind: 'filter'; value: string } | { kind: 'open'; id: number; title: string };

export function departmentShiftTitle(department: string, turn: 'guided' | 'solo') {
  return '[TRAINING] ' + department + (turn === 'guided' ? ' Night handover #3' : ' PM handover #2');
}

export function parseShiftMission(raw: string | null): ShiftMissionProgress {
  if (!raw) return { stage: 'intro' };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { stage: 'intro' };
    const state = value as Record<string, unknown>;
    if (!['intro','filter','open','answer','solo-open','solo-answer'].includes(String(state.stage))) return { stage: 'intro' };
    const safeId = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : undefined;
    const firstId = safeId(state.firstId), secondId = safeId(state.secondId);
    return { stage: state.stage as ShiftMissionStage,
      ...(firstId ? { firstId } : {}), ...(secondId ? { secondId } : {}) };
  } catch { return { stage: 'intro' }; }
}

export function verifyShiftRecord(
  record: unknown, title: string, departmentId: number,
): { id: number; status: string } | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const item = record as Record<string,unknown>;
  const id = Number(item.id);
  if (!Number.isSafeInteger(id) || id <= 0 || item.title !== title || Number(item.department_id) !== departmentId) return null;
  if (!['New', 'Seen', 'Follow', 'Done'].includes(String(item.status))) return null;
  return { id, status: String(item.status) };
}

export function sendShiftPracticeAction(action: ShiftPracticeAction) {
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_TRAINING_MODE === 'true') {
    window.dispatchEvent(new CustomEvent<ShiftPracticeAction>(SHIFT_PRACTICE_EVENT, { detail: action }));
  }
}
