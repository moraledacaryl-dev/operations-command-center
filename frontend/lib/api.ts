export const API_BASE = '/api/backend';
export const ASSET_BASE = '/api/uploads';

export type Entity = Record<string, any>;

export function assetUrl(url?: string) {
  if (!url) return '#';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/uploads/')) return `${ASSET_BASE}/${url.replace('/uploads/', '')}`;
  return url;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body instanceof FormData
    ? { ...(init.headers || {}) }
    : { 'Content-Type': 'application/json', ...(init?.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
      window.localStorage.removeItem('cc_user');
      window.localStorage.removeItem('cc_department_id');
      window.location.href = '/login';
    }
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  list: (resource: string, params: Record<string, any> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return request<Entity[]>(`/${resource}${qs.toString() ? `?${qs}` : ''}`);
  },
  get: (resource: string, id: number) => request<Entity>(`/${resource}/${id}`),
  create: (resource: string, data: Entity) => request<Entity>(`/${resource}`, { method: 'POST', body: JSON.stringify(data) }),
  update: (resource: string, id: number, data: Entity) => request<Entity>(`/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  status: (resource: string, id: number, status: string, note?: string) => request<Entity>(`/${resource}/${id}/status`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  archive: (resource: string, id: number) => request<Entity>(`/${resource}/${id}/archive`, { method: 'POST' }),
  comment: (resource: string, id: number, body: string, comment_type = 'General') => request<Entity>(`/${resource}/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, comment_type }) }),
  login: (email: string, password: string) => request<Entity>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<Entity>('/auth/logout', { method: 'POST' }),
  me: () => request<Entity>('/auth/me'),
  health: () => request<Entity>('/health'),
  changePassword: (current_password: string, new_password: string) => request<Entity>('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  adminCreateUser: (data: Entity) => request<Entity>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  adminResetUserPassword: (id: number, new_password: string) => request<Entity>(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password }) }),
  meta: () => request<Entity>('/meta'),
  departmentWorkspace: (departmentId: number) => request<Entity>(`/departments/${departmentId}/workspace`),
  reviewQueue: (params: Record<string, any> = {}) => { const qs = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); }); return request<Entity>(`/review/queue${qs.toString() ? `?${qs}` : ''}`); },
  generateRoutine: (id: number) => request<Entity>(`/routines/${id}/generate-task`, { method: 'POST' }),
  dashboard: (params: Record<string, any> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
    return request<Entity>(`/dashboard${qs.toString() ? `?${qs}` : ''}`);
  },
  integrationOverview: () => request<Entity>('/integrations/overview'),
  history: (params: Record<string, any> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
    return request<Entity[]>(`/history/search/all${qs.toString() ? `?${qs}` : ''}`);
  },
  versions: (postId: number) => request<Entity[]>(`/posts/${postId}/versions`),
  addVersion: (postId: number, form: FormData) => request<Entity>(`/posts/${postId}/versions`, { method: 'POST', body: form }),
  roomMemory: (roomId: number) => request<Entity>(`/rooms/${roomId}/memory`),
  runArchive: () => request<Entity>('/auto-archive/run', { method: 'POST' }),
  submitRequestApproval: (id: number, data: Entity = {}) => request<Entity>(`/workflow/requests/${id}/submit-approval`, { method: 'POST', body: JSON.stringify(data) }),
  decideApproval: (id: number, status: string, data: Entity = {}) => request<Entity>(`/workflow/approvals/${id}/decide?status=${encodeURIComponent(status)}`, { method: 'POST', body: JSON.stringify(data) }),
  guestCreateFix: (id: number, data: Entity = {}) => request<Entity>(`/workflow/guests/${id}/create-fix`, { method: 'POST', body: JSON.stringify(data) }),
  workflowCreateTask: (resource: string, id: number, data: Entity = {}) => request<Entity>(`/workflow/${resource}/${id}/create-task`, { method: 'POST', body: JSON.stringify(data) }),
  externalCreateTask: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/create-task`, { method: 'POST', body: JSON.stringify(data) }),
  externalCreateApproval: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/create-approval`, { method: 'POST', body: JSON.stringify(data) }),
  externalMarkSeen: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/mark-seen`, { method: 'POST', body: JSON.stringify(data) }),
  externalReject: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  verifyFix: (id: number, data: Entity) => request<Entity>(`/workflow/fixes/${id}/verify`, { method: 'POST', body: JSON.stringify(data) }),
  attach: (resource: string, id: number, form: FormData) => request<Entity>(`/${resource}/${id}/attachments`, { method: 'POST', body: form }),
};
