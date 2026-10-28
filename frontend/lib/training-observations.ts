import { Entity } from './api';
import { getCurrentDepartmentId } from './session';

/** Device-local observation evidence is NOT signed certification. */
export const TASK_INSPECTION_CHANGED = 'ho-ops-task-inspection-updated';
export type TaskInspectionEvidence = { departmentId: number; taskId: number; completedAt: string };

export function taskInspectionKey(user: Entity, departmentId: number): string {
  return 'ho-ops-task-inspection-v1:' + String(user.id || user.email) + ':' + departmentId;
}

export function readTaskInspections(user: Entity): TaskInspectionEvidence[] {
  if (typeof window === 'undefined') return [];
  const ids = new Set<number>();
  for (const candidate of [
    getCurrentDepartmentId(user), user.primary_department_id,
    ...(Array.isArray(user.departments) ? user.departments.map((dept: Entity) => dept.id) : []),
  ]) {
    const id = Number(candidate);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  const results: TaskInspectionEvidence[] = [];
  for (const departmentId of ids) {
    try {
      const raw = localStorage.getItem(taskInspectionKey(user, departmentId));
      if (!raw) continue;
      const row = JSON.parse(raw);
      if (!row || typeof row !== 'object') continue;
      const taskId = Number(row.taskId);
      if (!Number.isSafeInteger(taskId) || taskId <= 0 ||
          typeof row.completedAt !== 'string' ||
          !Number.isFinite(Date.parse(row.completedAt))) continue;
      results.push({ departmentId, taskId, completedAt: row.completedAt });
    } catch { /* Ignore unreadable device-local progress. */ }
  }
  return results;
}
