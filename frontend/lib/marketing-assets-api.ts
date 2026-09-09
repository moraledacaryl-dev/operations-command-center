import { API_BASE, Entity } from './api';

async function checked<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = 'Creative asset request could not be completed.';
    try {
      const payload = await res.json();
      if (typeof payload?.detail === 'string') message = payload.detail;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

export const marketingAssetsApi = {
  list: (conceptId: number) => checked<Entity[]>(`/marketing/concepts/${conceptId}/assets`),
  upload: (conceptId: number, file: File, title = '', note = '') => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    if (note) form.append('note', note);
    return checked<Entity>(`/marketing/concepts/${conceptId}/assets`, { method: 'POST', body: form });
  },
  versions: (assetId: number) => checked<Entity[]>(`/marketing/assets/${assetId}/versions`),
  addVersion: (assetId: number, file: File, note = '') => {
    const form = new FormData();
    form.append('file', file);
    if (note) form.append('note', note);
    return checked<Entity>(`/marketing/assets/${assetId}/versions`, { method: 'POST', body: form });
  },
  downloadUrl: (assetId: number, versionId: number) => `${API_BASE}/marketing/assets/${assetId}/versions/${versionId}/download`,
};
