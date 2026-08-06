'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const CREATE_ROUTES = new Set(['/tasks', '/requests', '/fixes', '/shift', '/projects']);

export function CreateIntentSync() {
  const pathname = usePathname();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    if (!CREATE_ROUTES.has(pathname) || searchParams.get('create') !== '1') return;

    let cancelled = false;
    let attempts = 0;

    const openCreateForm = () => {
      if (cancelled) return;
      attempts += 1;
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.topbar button'));
      const addButton = buttons.find(button => button.textContent?.trim() === 'Add');
      if (addButton) {
        addButton.click();
        const url = new URL(window.location.href);
        url.searchParams.delete('create');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        return;
      }
      if (attempts < 20) window.setTimeout(openCreateForm, 50);
    };

    openCreateForm();
    return () => { cancelled = true; };
  }, [pathname]);

  return null;
}
