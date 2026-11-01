'use client';

import { useEffect, useState } from 'react';
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
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [screen, setScreen] = useState({ width: 1100, height: 760 });

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
        found.scrollIntoView({ block: 'center', behavior: 'instant' });
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
  const boxHeight = 184;
  const top = rect
    ? rect.bottom + boxHeight + 20 <= screen.height
      ? rect.bottom + 16
      : Math.max(12, rect.top - boxHeight - 16)
    : 24;
  const goesAbove = Boolean(rect && top < rect.top);
  const style: CSSProperties = { width: boxWidth, left, top };

  return <div className="training-spotlight-layer" data-testid={testId}>
    <aside className="training-spotlight-popover" style={style} aria-label="Interactive lesson guidance">
      {rect && <span className={'training-spotlight-arrow' + (goesAbove ? ' arrow-down' : '')}
        aria-hidden="true">➜</span>}
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
