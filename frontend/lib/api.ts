export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api';

export type Entity = Record<string, any>;
export type CursorPage = { items: Entity[]; next_cursor?: string | null; has_more: boolean };

export class ApiError extends Error {
  status: number;
  requestId?: string;
  detail?: string;

  constructor(message: string, status: number, requestId?: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.detail = detail;
  }
}

function endpointFailureMessage(path: string, status: number) {
  if (path.startsWith('/review/queue')) return 'Review could not be loaded.';
  if (status === 403) return 'You do not have permission to complete this action.';
  if (status === 404) return 'The requested record could not be found.';
  if (status === 429) return 'Too many requests. Please try again shortly.';
  if (status >= 500) return 'The service is temporarily unavailable.';
  return 'The request could not be completed.';
}

function validationDetail(detail: unknown): string | undefined {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return undefined;
  const messages = detail
    .map(item => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, any>;
      const location = Array.isArray(record.loc) ? record.loc.slice(1).join(' ') : '';
      return [location, record.msg].filter(Boolean).join(': ');
    })
    .filter(Boolean);
  return messages.length ? messages.join('; ') : undefined;
}

async function normalizedError(res: Response, path: string) {
  const requestId = res.headers.get('X-Request-Id') || undefined;
  let detail: string | undefined;

  try {
    const payload = await res.clone().json();
    detail = validationDetail(payload?.detail) || validationDetail(payload?.message);
  } catch {
    const text = (await res.text()).trim();
    if (text && !text.startsWith('{') && !text.startsWith('[') && text.length <= 240) detail = text;
  }

  const safeMessage = detail && res.status < 500 && res.status !== 422
    ? detail
    : endpointFailureMessage(path, res.status);
  return new ApiError(safeMessage, res.status, requestId, detail);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body instanceof FormData
    ? { ...(init.headers || {}) }
    : { 'Content-Type': 'application/json', ...(init?.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
      window.localStorage.removeItem('cc_user');
      window.localStorage.removeItem('cc_department_id');
      window.location.href = '/login';
    }
    throw await normalizedError(res, path);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function download(path: string, filename: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!res.ok) throw await normalizedError(res, path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function allCursorPages(path: string, params: Record<string, any> = {}): Promise<Entity[]> {
  const items: Entity[] = [];
  let cursor = '';
  do {
    const qs = new URLSearchParams({ paginated: 'true', limit: '100' });
    Object.entries({ ...params, cursor }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    });
    const response = await request<CursorPage | Entity[]>(`${path}?${qs}`);
    if (Array.isArray(response)) {
      items.push(...response);
      break;
    }
    const page = response;
    items.push(...page.items);
    cursor = page.has_more && page.next_cursor ? page.next_cursor : '';
  } while (cursor);
  return items;
}

export const api = {
  list: (resource: string, params: Record<string, any> = {}, options: { signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return request<Entity[]>(`/${resource}${qs.toString() ? `?${qs}` : ''}`, { signal: options.signal });
  },
  page: (resource: string, params: Record<string, any> = {}, options: { signal?: AbortSignal } = {}) => {
    const qs = new URLSearchParams({ paginated: 'true' });
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return request<CursorPage>(`/${resource}?${qs}`, { signal: options.signal });
  },
  listAll: async (resource: string, params: Record<string, any> = {}, options: { signal?: AbortSignal } = {}) => {
    const items: Entity[] = [];
    let cursor = '';
    do {
      const qs = new URLSearchParams({ paginated: 'true', limit: '100' });
      Object.entries({ ...params, cursor }).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      });
      const response = await request<CursorPage | Entity[]>(`/${resource}?${qs}`, { signal: options.signal });
      if (Array.isArray(response)) {
        items.push(...response);
        break;
      }
      const page = response;
      items.push(...page.items);
      cursor = page.has_more && page.next_cursor ? page.next_cursor : '';
    } while (cursor);
    return items;
  },
  get: (resource: string, id: number) => request<Entity>(`/${resource}/${id}`),
  create: (resource: string, data: Entity) => request<Entity>(`/${resource}`, { method: 'POST', body: JSON.stringify(data) }),
  update: (resource: string, id: number, data: Entity) => request<Entity>(`/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  status: (resource: string, id: number, status: string, note?: string) => request<Entity>(`/${resource}/${id}/status`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  workflowAction: (resource: string, id: number, action: string, data: Entity = {}) => request<Entity>(`/workflow/${resource}/${id}/${action}`, { method: 'POST', body: JSON.stringify(data) }),
  archive: (resource: string, id: number) => request<Entity>(`/${resource}/${id}/archive`, { method: 'POST' }),
  comment: (resource: string, id: number, body: string, comment_type = 'General') => request<Entity>(`/${resource}/${id}/comments`, { method: 'POST', body: JSON.stringify({ body, comment_type }) }),
  login: (email: string, password: string) => request<Entity>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<Entity>('/auth/logout', { method: 'POST' }),
  me: () => request<Entity>('/auth/me'),
  users: () => request<Entity[]>('/users'),
  usersPage: (params: Record<string, any> = {}) => { const qs = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); }); return request<CursorPage>(`/users/page?${qs}`); },
  health: () => request<Entity>('/health'),
  changePassword: (current_password: string, new_password: string) => request<Entity>('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  adminCreateUser: (data: Entity) => request<Entity>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  adminResetUserPassword: (id: number, new_password: string) => request<Entity>(`/admin/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password }) }),
  adminUpdateUser: (id: number, data: Entity) => request<Entity>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  adminUpdateMembership: (id: number, data: Entity) => request<Entity>(`/admin/user-departments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  adminDeleteMembership: (id: number) => request<void>(`/admin/user-departments/${id}`, { method: 'DELETE' }),
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
    return request<CursorPage>(`/history/search/all${qs.toString() ? `?${qs}` : ''}`);
  },
  versions: (postId: number) => request<Entity[]>(`/posts/${postId}/versions`),
  addVersion: (postId: number, form: FormData) => request<Entity>(`/posts/${postId}/versions`, { method: 'POST', body: form }),
  downloadAttachment: (attachmentId: number, filename: string) => download(`/attachments/${attachmentId}/download`, filename),
  downloadPostVersion: (postId: number, versionId: number, filename: string) => download(`/posts/${postId}/versions/${versionId}/download`, filename),
  roomMemory: (roomId: number) => request<Entity>(`/rooms/${roomId}/memory`),
  runArchive: () => request<Entity>('/auto-archive/run', { method: 'POST' }),
  submitRequestApproval: (id: number, data: Entity = {}) => request<Entity>(`/workflow/requests/${id}/submit-approval`, { method: 'POST', body: JSON.stringify(data) }),
  decideApproval: (id: number, status: string, data: Entity = {}) => request<Entity>(`/workflow/approvals/${id}/decide?status=${encodeURIComponent(status)}`, { method: 'POST', body: JSON.stringify(data) }),
  decideSubmission: (id: number, status: 'Accepted' | 'Rejected', data: Entity = {}) => request<Entity>(`/workflow/submissions/${id}/decide`, { method: 'POST', body: JSON.stringify({ status, ...data }) }),
  guestCreateFix: (id: number, data: Entity = {}) => request<Entity>(`/workflow/guests/${id}/create-fix`, { method: 'POST', body: JSON.stringify(data) }),
  workflowCreateTask: (resource: string, id: number, data: Entity = {}) => request<Entity>(`/workflow/${resource}/${id}/create-task`, { method: 'POST', body: JSON.stringify(data) }),
  externalCreateTask: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/create-task`, { method: 'POST', body: JSON.stringify(data) }),
  externalCreateApproval: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/create-approval`, { method: 'POST', body: JSON.stringify(data) }),
  externalMarkSeen: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/mark-seen`, { method: 'POST', body: JSON.stringify(data) }),
  externalReject: (id: number, data: Entity = {}) => request<Entity>(`/integrations/review-items/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  verifyFix: (id: number, data: Entity) => request<Entity>(`/workflow/fixes/${id}/verify`, { method: 'POST', body: JSON.stringify(data) }),
  marketingCampaigns: () => allCursorPages('/marketing/campaigns'),
  createMarketingCampaign: (data: Entity) => request<Entity>('/marketing/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  marketingConcepts: (campaignId?: number) => allCursorPages('/marketing/concepts', campaignId ? { campaign_id: campaignId } : {}),
  createMarketingConcept: (data: Entity) => request<Entity>('/marketing/concepts', { method: 'POST', body: JSON.stringify(data) }),
  marketingCalendar: (params: Record<string, any>) => allCursorPages('/marketing/calendar', params),
  marketingDeliverableAction: (id: number, action: string, data: Entity = {}) => request<Entity>(`/marketing/deliverables/${id}/transition/${action}`, { method: 'POST', body: JSON.stringify(data) }),
  rescheduleMarketingDeliverable: (id: number, scheduledAt: string | null) => request<Entity>(`/marketing/deliverables/${id}/reschedule`, { method: 'POST', body: JSON.stringify({ scheduled_at: scheduledAt }) }),
  notifications: (params: Record<string, any> = {}) => { const qs = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); }); return request<CursorPage & { unread_count: number }>(`/notifications${qs.toString() ? `?${qs}` : ''}`); },
  readNotification: (id: number) => request<Entity>(`/notifications/${id}/read`, { method: 'POST' }),
  readAllNotifications: () => request<Entity>('/notifications/read-all', { method: 'POST' }),
  dismissNotification: (id: number) => request<Entity>(`/notifications/${id}/dismiss`, { method: 'POST' }),
  attach: (resource: string, id: number, form: FormData) => request<Entity>(`/${resource}/${id}/attachments`, { method: 'POST', body: form }),
};
