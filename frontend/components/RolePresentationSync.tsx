'use client';

import { useEffect } from 'react';
import { getStoredUser } from '@/lib/session';
import { normalizeRole } from '@/lib/capabilities';

export function RolePresentationSync() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const role = normalizeRole(getStoredUser()?.role) || 'signed-out';
      root.dataset.role = role;
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return null;
}
