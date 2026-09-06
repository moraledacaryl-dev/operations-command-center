'use client';

import { useEffect } from 'react';

type MediaRow = { slot: string; content_url?: string | null };

const variableBySlot: Record<string, string> = {
  login_background: '--property-login-background',
  dashboard_hero: '--property-dashboard-hero',
  property_cover: '--property-cover',
  room_placeholder: '--property-room-placeholder',
};

export function PropertyMediaSync() {
  useEffect(() => {
    let cancelled = false;
    fetch('/api/property-media', { cache: 'no-store', credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : [])
      .then((rows: MediaRow[]) => {
        if (cancelled || !Array.isArray(rows)) return;
        for (const row of rows) {
          const variable = variableBySlot[row.slot];
          if (!variable) continue;
          if (row.content_url) document.documentElement.style.setProperty(variable, `url("${row.content_url}")`);
          else document.documentElement.style.removeProperty(variable);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return null;
}
