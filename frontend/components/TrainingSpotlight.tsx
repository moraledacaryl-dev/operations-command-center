'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export type FocusTarget = { selector: string; containsText?: string };

type Props = {
  title: string;
  description: string;
  stepLabel?: string;
  targets?: FocusTarget[];
  onClose: () => void;
  onNext?: () => void;
  nextLabel?: string;
  onRepeat?: () => void;
  repeatLabel?: string;
  testId?: string;
};

function locateTarget(targets: FocusTarget[]): HTMLElement | null {
  for (const target of targets) {
    try {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(target.selector))) {
        if (target.containsText && !node.textContent?.toLowerCase().includes(target.containsText.toLowerCase())) continue;
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        return node;
      }
    } catch { /* Unsupported or missing selectors are never actionable. */ }
  }
  return null;
}

/** A non-blocking coach: real controls remain clickable, keyboard-reachable and owned
 * by their screen. The pointer and focus box are visual, not synthetic clicks.
 */
export function TrainingSpotlight({
  title, description, stepLabel, targets = [], onClose, onNext, nextLabel,
  onRepeat, repeatLabel, testId = 'training-spotlight',
}: Props) {
  const popoverRef = useRef<HTMLElement | null>(null);
  const [popoverHeight, setPopoverHeight] = useState(280);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [screen, setScreen] = useState({ width: 1100, height: 760 });

  useEffect(() => {
    const node = popoverRef.current;
    if (!node) return;
    const measure = () => setPopoverHeight(current => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      return Math.abs(current - next) < 2 ? current : next;
    });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);

  const targetKey = JSON.stringify(targets);
  useEffect(() => {
    const selectors = JSON.parse(targetKey) as FocusTarget[];
    let marked: HTMLElement | null = null;
    let lastFound: HTMLElement | null = null;
    let animation = 0;
    const refresh = () => {
      const found = locateTarget(selectors);
      if (marked !== found) {
        if (marked) marked.removeAttribute('data-training-spotlight-target');
        if (found) found.setAttribute('data-training-spotlight-target', 'true');
        marked = found;
      }
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setScreen(current => current.width === viewport.width && current.height === viewport.height ? current : viewport);
      setRect(found ? found.getBoundingClientRect() : null);
      if (found && found !== lastFound) {
        lastFound = found;
        // Never scroll the user's open form away just because a field's text changed.
        found.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    };
    const schedule = () => {
      window.cancelAnimationFrame(animation);
      animation = window.requestAnimationFrame(refresh);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    refresh();
    return () => {
      window.cancelAnimationFrame(animation);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (marked) marked.removeAttribute('data-training-spotlight-target');
    };
  }, [targetKey]);

  const boxWidth = Math.min(350, Math.max(240, screen.width - 24));
  const left = rect
    ? Math.max(12, Math.min(rect.left, screen.width - boxWidth - 12))
    : Math.max(12, Math.round((screen.width - boxWidth) / 2));
  const clearance = screen.width < 640 ? 88 : 12;
  const maxHeight = Math.max(100, screen.height - clearance - 12);
  const boxHeight = Math.min(popoverHeight, maxHeight);
  const preferredTop = rect
    ? rect.bottom + boxHeight + 20 <= screen.height - clearance
      ? rect.bottom + 16
      : rect.top - boxHeight - 16
    : 24;
  const top = Math.max(12, Math.min(preferredTop, screen.height - boxHeight - clearance));
  const goesAbove = Boolean(rect && top < rect.top);
  const style: CSSProperties = { width: boxWidth, left, top, maxHeight };

  return <div className="training-spotlight-layer" data-testid={testId}>
    {rect && <span className={'training-spotlight-arrow' + (goesAbove ? ' arrow-down' : '')}
      style={{ position: 'fixed', left: left + 22, top: goesAbove ? top + boxHeight : Math.max(0, top - 30), bottom: 'auto' }}
      aria-hidden="true">➜</span>}
    <aside ref={popoverRef} className="training-spotlight-popover" style={style} aria-label="Interactive lesson guidance">
      <div className="training-spotlight-topline">
        <span className="training-spotlight-kicker">{stepLabel || 'START HERE'}</span>
        <button type="button" className="training-spotlight-dismiss"
          onClick={onClose} aria-label="Hide lesson arrows">×</button>
      </div>
      <strong className="training-spotlight-title">{title}</strong>
      <p className="training-spotlight-description">{description}</p>
      <div className="training-spotlight-actions">
        {onNext && <button type="button" className="training-spotlight-main"
          onClick={onNext}>{nextLabel || 'Next →'}</button>}
        {onRepeat && <button type="button" className="training-spotlight-again"
          onClick={onRepeat}>{repeatLabel || 'Repeat lesson'}</button>}
      </div>
      {rect && <span className="training-spotlight-instruction">Follow the orange outline and arrow. Use the actual control—it will advance when you complete the step.</span>}
    </aside>
  </div>;
}
