'use client';

import { useEffect } from 'react';
import type { RefObject } from 'react';

/** Keep required lesson dialogs keyboard usable without trapping the real-page tour. */
export function useTrainingDialogFocus(ref: RefObject<HTMLElement>, active: boolean, screen: string) {
  useEffect(() => {
    if (!active) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary,textarea:not([disabled]),[tabindex="0"]',
    )).filter(node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const nodes = controls();
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref, screen]);
}
