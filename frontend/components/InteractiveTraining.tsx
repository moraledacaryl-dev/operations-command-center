'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { availableTrainingLessons, TRAINING_LESSONS } from '@/lib/interactive-training';
import type { TrainingStep } from '@/lib/interactive-training';

type Position = { top: number; left: number; width: number; height: number };
type Active = { id: string; index: number };

const COMPLETION_PREFIX = 'ho-ops-training-complete-v1:';

function targetFor(selector: string): HTMLElement | null {
  try {
    // Do not highlight hidden desktop/mobile duplicates or closed navigation groups.
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .find(node => node.getClientRects().length > 0 && window.getComputedStyle(node).visibility !== 'hidden') || null;
  } catch {
    return null;
  }
}

function positionFor(node: HTMLElement): Position {
  const rect = node.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function closeEnough(a: Position | null, b: Position) {
  return Boolean(a && Math.abs(a.top - b.top) < 2 && Math.abs(a.left - b.left) < 2
    && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2);
}

function popupStyle(position: Position | null): React.CSSProperties {
  if (!position || typeof window === 'undefined') return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  const compact = window.innerWidth < 640;
  if (compact) return { left: 12, right: 12, bottom: 80 };
  const width = Math.min(360, window.innerWidth - 32);
  const left = Math.max(16, Math.min(window.innerWidth - width - 16, position.left + position.width / 2 - width / 2));
  const below = position.top + position.height + 18;
  const top = below + 230 > window.innerHeight ? Math.max(16, position.top - 236) : below;
  return { left, top, width };
}

export function InteractiveTraining({ user, path }: { user: Entity; path: string }) {
  const router = useRouter();
  const capabilities = useMemo(() => ({
    manage_department: hasCapability(user, 'manage_department'),
    make_decisions: hasCapability(user, 'make_decisions'),
    manage_accounts: hasCapability(user, 'manage_accounts'),
    view_all_operations: hasCapability(user, 'view_all_operations'),
  }), [user]);
  const lessons = useMemo(() => availableTrainingLessons(capabilities, user.departments || []), [capabilities, user.departments]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [targetFound, setTargetFound] = useState(false);
  const [complete, setComplete] = useState<string[]>([]);
  const observedNode = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLElement | null>(null);
  const [tipPosition, setTipPosition] = useState<Position | null>(null);
  const [helpMessage, setHelpMessage] = useState('');
  const identity = String(user.id || user.email || 'signed-in-user');
  const storageKey = COMPLETION_PREFIX + identity;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setComplete(Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : []);
    } catch { setComplete([]); }
  }, [storageKey]);

  const lesson = active ? TRAINING_LESSONS.find(entry => entry.id === active.id) : undefined;
  const step: TrainingStep | undefined = lesson && active ? lesson.steps[active.index] : undefined;
  const stepIndex = active?.index || 0;
  const atLastStep = Boolean(lesson && stepIndex === lesson.steps.length - 1);

  const finish = useCallback((lessonId: string) => {
    setComplete(current => {
      const next = Array.from(new Set([...current, lessonId]));
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage optional */ }
      return next;
    });
    setPosition(null);
    setActive(null);
    setMenuOpen(true);
    setHelpMessage('Lesson completed. Choose another lesson or close the training library.');
  }, [storageKey]);

  const next = useCallback(() => {
    if (!active || !lesson) return;
    setHelpMessage('');
    setPosition(null);
    if (atLastStep) finish(lesson.id);
    else setActive({ id: lesson.id, index: active.index + 1 });
  }, [active, lesson, atLastStep, finish]);

  const previous = useCallback(() => {
    if (!active) return;
    setPosition(null);
    setHelpMessage('');
    setActive({ ...active, index: Math.max(0, active.index - 1) });
  }, [active]);

  const exit = useCallback(() => {
    setActive(null);
    setPosition(null);
    setTargetFound(false);
    setHelpMessage('');
  }, []);

  const begin = useCallback((lessonId: string) => {
    setMenuOpen(false);
    setHelpMessage('');
    setPosition(null);
    setActive({ id: lessonId, index: 0 });
  }, []);

  useEffect(() => {
    if (!active || !lesson || !lessons.some(item => item.id === lesson.id)) exit();
  }, [active, lesson, lessons, exit]);

  useEffect(() => {
    if (!step) return;
    if (path !== step.path) {
      setTargetFound(false);
      setPosition(null);
      router.push(step.path);
    }
  }, [path, router, step]);

  useEffect(() => {
    if (!step || path !== step.path) return;
    let cancelled = false;
    let lastNode: HTMLElement | null = null;
    let scrolled = false;
    let pendingFrame = 0;

    const refresh = () => {
      if (cancelled) return;
      const node = targetFor(step.selector);
      observedNode.current = node;
      setTargetFound(Boolean(node));
      if (!node) { setPosition(null); return; }
      if (node !== lastNode) { lastNode = node; scrolled = false; }
      if (!scrolled) {
        scrolled = true;
        node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      const nextPosition = positionFor(node);
      setPosition(current => closeEnough(current, nextPosition) ? current : nextPosition);
    };
    const queueRefresh = () => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(refresh);
    };
    queueRefresh();
    const observer = new MutationObserver(queueRefresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open', 'hidden'] });
    window.addEventListener('scroll', queueRefresh, true);
    window.addEventListener('resize', queueRefresh);
    return () => {
      cancelled = true;
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      observer.disconnect();
      observedNode.current = null;
      window.removeEventListener('scroll', queueRefresh, true);
      window.removeEventListener('resize', queueRefresh);
    };
  }, [step, path]);

  useEffect(() => {
    if (!step?.advanceOnClick || path !== step.path || !active) return;
    const node = targetFor(step.selector);
    if (!node) return;
    const click = () => { window.setTimeout(() => { if (document.body.contains(node) || step.advanceOnClick) next(); }, 100); };
    node.addEventListener('click', click, { once: true });
    return () => node.removeEventListener('click', click);
  }, [active, path, step, targetFound, next]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (active) exit(); else setMenuOpen(false); return; }
      if (!active || event.altKey || event.metaKey || event.ctrlKey) return;
      const editing = event.target instanceof HTMLElement && Boolean(event.target.closest('input,textarea,select,[contenteditable="true"]'));
      if (editing) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active, next, previous, exit]);

  useEffect(() => {
    if (!position || !step || path !== step.path) { setTipPosition(null); return; }
    const frame = requestAnimationFrame(() => {
      const node = tipRef.current;
      if (!node) return;
      const nextPosition = positionFor(node);
      setTipPosition(current => closeEnough(current, nextPosition) ? current : nextPosition);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, position, step, path, targetFound]);

  const arrow = position && tipPosition && typeof window !== 'undefined' ? (() => {
    const tx = Math.min(window.innerWidth - 20, Math.max(20, position.left + position.width / 2));
    const ty = Math.min(window.innerHeight - 20, Math.max(20, position.top + position.height / 2));
    const cx = tipPosition.left + tipPosition.width / 2;
    const cy = Math.abs(ty - tipPosition.top) < Math.abs(ty - tipPosition.top - tipPosition.height)
      ? tipPosition.top : tipPosition.top + tipPosition.height;
    const distance = Math.max(1, Math.hypot(tx - cx, ty - cy));
    const dx = (tx - cx) / distance, dy = (ty - cy) / distance;
    const endX = tx - dx * 14, endY = ty - dy * 14;
    return {
      line: `M ${cx} ${cy} L ${endX} ${endY}`,
      head: `${tx},${ty} ${tx - dx * 19 - dy * 8},${ty - dy * 19 + dx * 8} ${tx - dx * 19 + dy * 8},${ty - dy * 19 - dx * 8}`,
    };
  })() : null;

  const spotlight = position && path === step?.path ? {
    top: Math.max(0, position.top - 6),
    left: Math.max(0, position.left - 6),
    width: position.width + 12,
    height: position.height + 12,
  } : null;

  return <>
    <button type="button" className="ops-guide-launch" data-testid="interactive-training-open"
      aria-label="Open interactive training" onClick={() => { exit(); setMenuOpen(true); }}>
      <span aria-hidden="true">?</span> Training
    </button>

    {menuOpen && !active && <div className="ops-guide-library-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <section className="ops-guide-library" role="dialog" aria-modal="true" aria-label="Interactive staff training">
        <header className="ops-guide-library-header">
          <div><span className="ops-guide-eyebrow">OPERATIONS LEARNING CENTER</span><h2>Interactive training</h2><p>Follow highlighted controls on the real app. Your available lessons match your system permissions.</p></div>
          <button type="button" className="ops-guide-close" aria-label="Close training" onClick={() => setMenuOpen(false)}>×</button>
        </header>
        {helpMessage && <p className="ops-guide-success" role="status">{helpMessage}</p>}
        <p className="ops-guide-safety"><strong>Safe practice:</strong> Lessons never save, approve, or publish automatically. Use only an isolated demo workspace to submit fictional practice records.</p>
        <div className="ops-guide-lesson-grid">
          {lessons.map(item => <button type="button" key={item.id} className="ops-guide-lesson" onClick={() => begin(item.id)}>
            <span className="ops-guide-lesson-title">{item.title}{complete.includes(item.id) ? <span className="ops-guide-done">Completed</span> : null}</span>
            <span className="ops-guide-lesson-description">{item.summary}</span>
            <span className="ops-guide-lesson-meta">{item.steps.length} guided steps · Start lesson →</span>
          </button>)}
        </div>
        <p className="ops-guide-footer-note">Progress is stored on this device for this account. Resetting the browser or changing devices may clear it.</p>
      </section>
    </div>}

    {active && step && lesson && <>
      {spotlight && <div className="ops-guide-spotlight" aria-hidden="true" style={spotlight}/>}
      {arrow && <svg className="ops-guide-arrow" aria-hidden="true" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <path d={arrow.line} fill="none" stroke="#ffffff" strokeWidth="8" strokeLinecap="round" opacity=".75" />
        <path d={arrow.line} fill="none" stroke="#21d395" strokeWidth="4" strokeLinecap="round" />
        <polygon points={arrow.head} fill="#21d395" stroke="#ffffff" strokeWidth="2" />
      </svg>}
      <section ref={tipRef} className="ops-guide-tip" role="dialog" aria-modal="false"
        aria-label={`Training step ${stepIndex + 1} of ${lesson.steps.length}`} style={popupStyle(position)}>
        <div className="ops-guide-tip-top"><span>STEP {stepIndex + 1} / {lesson.steps.length}</span><button type="button" onClick={exit} aria-label="Exit walkthrough">Exit ×</button></div>
        <div className="ops-guide-progress" aria-hidden="true"><span style={{ width: `${(stepIndex + 1) / lesson.steps.length * 100}%` }} /></div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {path !== step.path ? <p className="ops-guide-hint">Opening the correct page…</p>
          : !targetFound ? <p className="ops-guide-hint">This control is not visible yet. Check the page or continue to the next step.</p>
          : step.advanceOnClick ? <p className="ops-guide-hint">↖ Click the highlighted control, or select Next to continue.</p>
          : <p className="ops-guide-hint">↖ Look at the highlighted area, then select Next.</p>}
        <div className="ops-guide-actions">
          <button type="button" className="ops-guide-button-secondary" onClick={previous} disabled={stepIndex === 0}>Back</button>
          <button type="button" className="ops-guide-button-primary" onClick={next}>{atLastStep ? 'Finish lesson' : 'Next →'}</button>
        </div>
        <button type="button" className="ops-guide-more" onClick={() => { exit(); setMenuOpen(true); }}>All lessons</button>
      </section>
    </>}
  </>;
}
