'use client';

import { API_BASE, ApiError, Entity } from '@/lib/api';

function headers() {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  try {
    const raw = window.localStorage.getItem('cc_user');
    const user = raw ? JSON.parse(raw) : null;
    return { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) };
  } catch {
    return { 'Content-Type': 'application/json' };
  }
}

async function command(path: string, data: Entity = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let detail = 'Workflow action could not be completed.';
    try {
      const payload = await res.json();
      if (typeof payload?.detail === 'string') detail = payload.detail;
    } catch {}
    throw new ApiError(detail, res.status, res.headers.get('X-Request-Id') || undefined, detail);
  }
  return res.json();
}

export const workflowApi = {
  planRequest: (id: number, data: Entity = {}) => command(`/workflow/requests/${id}/plan`, data),
  completeRequest: (id: number, data: Entity = {}) => command(`/workflow/requests/${id}/complete`, data),
  startFix: (id: number, data: Entity = {}) => command(`/workflow/fixes/${id}/start`, data),
  doneFix: (id: number, data: Entity = {}) => command(`/workflow/fixes/${id}/done`, data),
  reopenFix: (id: number, data: Entity) => command(`/workflow/fixes/${id}/reopen`, data),
};
