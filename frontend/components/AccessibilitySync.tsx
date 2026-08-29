'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const routeLabels: Record<string, string[]> = {
  '/departments': ['Department workspace'],
  '/history': ['Record type'],
  '/rooms': ['Room or area type'],
};

function applyAccessibleNames(pathname: string) {
  const labels = routeLabels[pathname] || [];
  const unnamed = Array.from(document.querySelectorAll<HTMLSelectElement>('select:not([aria-label]):not([aria-labelledby])'));
  unnamed.forEach((select, index) => {
    const explicitLabel = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
    if (explicitLabel || select.closest('label')) return;
    select.setAttribute('aria-label', labels[index] || 'Select option');
  });
}

export function AccessibilitySync() {
  const pathname = usePathname();

  useEffect(() => {
    applyAccessibleNames(pathname);
    const observer = new MutationObserver(() => applyAccessibleNames(pathname));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
