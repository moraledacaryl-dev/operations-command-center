import { Entity } from './api';
import { getCurrentDepartmentId } from './session';

/** Device-local reading practice, never a signed or server-certified result. */
export const TASK_INSPECTION_CHANGED = 'ho-ops-record-inspection-updated';
export type TrainingInspectionKind = 'task' | 'handover';
export type TrainingInspectionEvidence = {
  kind: TrainingInspectionKind;
  departmentId: number;
  recordId: number;
  completedAt: string;
};

export function trainingInspectionKey(
  user: Entity, departmentId: number, kind: TrainingInspectionKind = 'task',
): string {
  const prefix = kind === 'handover' ? 'ho-ops-handover-inspection-v1:' : 'ho-ops-task-inspection-v1:';
  return prefix + String(user.id || user.email) + ':' + departmentId;
}

/** Include only valid progress belonging to this account's authorized departments. */
export function readTrainingInspections(user: Entity): TrainingInspectionEvidence[] {
  if (typeof window === 'undefined') return [];
  const ids = new Set<number>();
  for (const candidate of [
    getCurrentDepartmentId(user), user.primary_department_id,
    ...(Array.isArray(user.departments) ? user.departments.map((dept: Entity) => dept.id) : []),
  ]) {
    const id = Number(candidate);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  const results: TrainingInspectionEvidence[] = [];
  for (const departmentId of Array.from(ids)) {
    for (const kind of ['task', 'handover'] as const) {
      try {
        const raw = localStorage.getItem(trainingInspectionKey(user, departmentId, kind));
        if (!raw) continue;
        const row = JSON.parse(raw);
        if (!row || typeof row !== 'object') continue;
        const recordId = Number(row.recordId ?? row.taskId);
        if (!Number.isSafeInteger(recordId) || recordId <= 0 ||
            typeof row.completedAt !== 'string' ||
            !Number.isFinite(Date.parse(row.completedAt))) continue;
        results.push({ kind, departmentId, recordId, completedAt: row.completedAt });
      } catch { /* Ignore unreadable user/device-local progress. */ }
    }
  }
  return results;
}
