import { Entity } from './api';

const USER_KEY = 'cc_user';
const DEPT_KEY = 'cc_department_id';

export function getStoredUser(): Entity | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setStoredUser(user: Entity) {
  const { token: _token, ...safeUser } = user;
  window.localStorage.setItem(USER_KEY, JSON.stringify(safeUser));
  const primary = user.primary_department_id || user.departments?.[0]?.id;
  if (primary) window.localStorage.setItem(DEPT_KEY, String(primary));
}

export function clearStoredUser() {
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(DEPT_KEY);
}

export function getCurrentDepartmentId(user?: Entity | null): number | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(DEPT_KEY);
  if (stored) return Number(stored);
  const primary = user?.primary_department_id || user?.departments?.[0]?.id;
  return primary ? Number(primary) : null;
}

export function setCurrentDepartmentId(id: number) {
  window.localStorage.setItem(DEPT_KEY, String(id));
}

export function landingPathForUser(user: Entity): string {
  const departments = user.departments || [];
  if (['owner', 'admin', 'manager'].includes(user.role)) return '/';
  if (departments.length) return '/my-work';
  return '/my-work';
}

export function canUseAdmin(user?: Entity | null): boolean {
  return !!user && ['owner', 'admin', 'manager'].includes(String(user.role || '').toLowerCase());
}
