'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { availableTrainingLessons, TRAINING_LESSONS } from '@/lib/interactive-training';
import type { TrainingStep } from '@/lib/interactive-training';
import { COURSE_GUIDES, COURSE_STORAGE_PREFIX, readCourseProgress } from '@/lib/training-course';
import type { CourseProgress } from '@/lib/training-course';
import { INDEPENDENT_CHECKS, independentActionMatches } from '@/lib/training-independent';
import { buildTrainingReport, parseTrainingReport, portableLearningCredit } from '@/lib/training-progress-report';
import { TrainerReports } from '@/components/TrainerReports';
import { WORKFLOW_CHANGED, WORKFLOW_DEFINITIONS, makeTrainingReference, workflowOwnerId, workflowResultsKey, workflowSessionKey } from '@/lib/training-workflows';
import type { TrainingWorkflowSession, TrainingWorkflowResults, TrainingWorkflowKind } from '@/lib/training-workflows';

type Position = { top: number; left: number; width: number; height: number };
type Active = { id: string; index: number };

const COMPLETION_PREFIX = 'ho-ops-training-complete-v1:';
// Lesson explanations, quiz state, and practical outcomes live together. Only
// the verified local workflow database may confirm a record-editing practical.

function targetFor(selector: string): HTMLElement | null {
  try {
    // Do not highlight hidden desktop/mobile duplicates or closed navigation groups.
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .find(node => {
        const rect = node.getBoundingClientRect();
        return node.getClientRects().length > 0
          && window.getComputedStyle(node).visibility !== 'hidden'
          && window.getComputedStyle(node).display !== 'none';
      }) || null;
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

function popupStyle(position: Position | null, measuredTipHeight?: number): React.CSSProperties {
  if (!position || typeof window === 'undefined') return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  if (window.innerWidth < 640) return { left: 12, right: 12, bottom: 80 };

  const margin = 14;
  const gap = 18;
  const width = Math.min(420, window.innerWidth - 2 * margin);
  const height = Math.max(190, measuredTipHeight || 290);
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const centeredLeft = Math.max(margin, Math.min(viewportWidth - width - margin, position.left + position.width / 2 - width / 2));
  const spaceAbove = position.top - margin;
  const spaceBelow = viewportHeight - (position.top + position.height) - margin;

  // Prefer above/below without obscuring the highlighted element. Measure the
  // actual popup height: a fixed estimate caused long instructions to cover forms.
  if (spaceBelow >= height + gap) return { left: centeredLeft, top: position.top + position.height + gap, width };
  if (spaceAbove >= height + gap) return { left: centeredLeft, top: position.top - height - gap, width };

  // If the focused element is tall, first try an adjacent side.
  const right = viewportWidth - (position.left + position.width) - margin;
  const left = position.left - margin;
  const centeredTop = Math.max(margin, Math.min(viewportHeight - height - margin, position.top + position.height / 2 - height / 2));
  if (right >= width + gap) return { left: position.left + position.width + gap, top: centeredTop, width };
  if (left >= width + gap) return { left: position.left - width - gap, top: centeredTop, width };

  // In a constrained viewport, minimize rather than conceal overlap.
  if (spaceAbove >= spaceBelow) return { left: centeredLeft, top: Math.max(margin, position.top - height - gap), width };
  return { left: centeredLeft, top: Math.min(viewportHeight - height - margin, position.top + position.height + gap), width };
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
  const [course, setCourse] = useState<CourseProgress | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [quizFeedback, setQuizFeedback] = useState('');
  const [restoreMessage, setRestoreMessage] = useState('');
  const [quizErrors, setQuizErrors] = useState(0);
  const [branchAnswer, setBranchAnswer] = useState<number | null>(null);
  const [branchExplained, setBranchExplained] = useState(false);
  const observedNode = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLElement | null>(null);
  const libraryRef = useRef<HTMLElement | null>(null);
  const [tipPosition, setTipPosition] = useState<Position | null>(null);
  const [helpMessage, setHelpMessage] = useState('');
  const identity = String(user.id || user.email || 'signed-in-user');
  const storageKey = COMPLETION_PREFIX + identity;
  const courseKey = COURSE_STORAGE_PREFIX + identity;
  const latestLessons = useRef(lessons);
  latestLessons.current = lessons;
  const courseLesson = course && lessons.find(item => item.id === course.lessonId);
  const courseGuide = courseLesson ? COURSE_GUIDES[courseLesson.id] : undefined;
  const repeatVariant = courseGuide?.repeatVariant && (course?.metrics?.[course?.lessonId || '']?.repeats || 0) % 2 === 1
    ? courseGuide.repeatVariant : undefined;
  const currentExample = repeatVariant?.example || courseGuide?.example;
  const currentQuestions = repeatVariant?.questions || courseGuide?.questions;
  const quizItem = currentQuestions?.[course?.question || 0];
  const lessonNumber = lessons.findIndex(item => item.id === course?.lessonId) + 1;

  async function restoreTrainingProgress(file: File | undefined) {
    if (!file || !course) return;
    if (file.size > 120000) { setRestoreMessage('This is not a normal progress file. Please export a new report from the training app.'); return; }
    try {
      const report = parseTrainingReport(JSON.parse(await file.text()) as unknown);
      if (!report || report.trainee.id !== identity) {
        setRestoreMessage('The report is invalid or belongs to a different practice account. No progress changed.'); return;
      }
      const credits = portableLearningCredit(report, lessons.map(item=>item.id));
      const nextLesson = lessons.find(item=>!credits.includes(item.id));
      setCourse(current=>current ? {
        ...current, lessonId:nextLesson?.id || lessons[0].id,
        stage:nextLesson?'learn':'finished', question:0, independentStep:0,
        reference:undefined, passed:credits, metrics:report.metrics,
      }:current);
      setRestoreMessage('Imported read-only lessons from this practice account. Lessons with saved task/guest/maintenance records must be practised and verified again on this device. This is not a skills certificate.');
    } catch { setRestoreMessage('This file could not be read. Export a fresh training report and try again.'); }
  }

  function restartCurrentLessonSafely() {
    if (!course) return;
    if (course.stage==='work') {
      try { localStorage.removeItem(workflowSessionKey(user)); window.dispatchEvent(new Event(WORKFLOW_CHANGED)); }
      catch { /* Course cannot pass without saved work regardless. */ }
    }
    setActive(null); setMenuOpen(false); setQuizFeedback(''); setSelectedAnswer(null);
    setCourse({ ...course, stage:'learn', question:0, independentStep:0, reference:undefined });
  }

  function exportTrainingProgress() {
    if (!course) return;
    let workflows: TrainingWorkflowResults = {};
    try { workflows = JSON.parse(localStorage.getItem(workflowResultsKey(user)) || '{}') as TrainingWorkflowResults; }
    catch { /* Export without unparseable workflow data. */ }
    const report = buildTrainingReport(course, { id:user.id, name:user.name, role:user.role }, workflows, new Date().toISOString());
    const blob = new Blob([JSON.stringify(report,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hidden-oasis-training-progress-' + String(user.id || 'demo').replace(/[^a-z0-9_-]/gi,'') + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  const independentActions = course ? INDEPENDENT_CHECKS[course.lessonId] : null;
  const independentAction = course && independentActions?.[course.independentStep || 0];

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setComplete(Array.isArray(saved) ? saved.filter((v): v is string => typeof v === 'string') : []);
    } catch { setComplete([]); }
  }, [storageKey]);

  // Begin lesson one automatically on sign-in; repeat / resume does not skip
  // the explanation or the quiz. Store only convenience progress, not a credential.
  useEffect(() => {
    if (!lessons.length) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(courseKey); } catch { /* in-memory fallback */ }
    setCourse(readCourseProgress(saved, latestLessons.current));
  }, [courseKey]);

  useEffect(() => {
    if (!course) return;
    try { localStorage.setItem(courseKey, JSON.stringify(course)); } catch { /* no certificate */ }
  }, [courseKey, course]);

  // A resumed tour displays an explicit Resume button; closing the coach
  // must never restart a tour unexpectedly or mark the practical complete.

  // A database-backed saved fictional workflow (same unique reference) is
  // required for lessons that edit records. No Next button can grant a pass.
  useEffect(() => {
    if (!course || course.stage !== 'work' || !course.reference || !courseGuide?.handsOn) return;
    const check = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(workflowResultsKey(user)) || '{}') as TrainingWorkflowResults;
        const evidence = saved[courseGuide.handsOn!];
        if (evidence?.reference !== course.reference || !evidence.recordId) return;
        setCourse(current => current && current.stage === 'work' && current.reference === evidence.reference
          ? { ...current, stage: 'independent', independentStep: 0 }
          : current);
      } catch { /* An invalid local marker never completes a practical. */ }
    };
    check();
    window.addEventListener(WORKFLOW_CHANGED, check);
    window.addEventListener('storage', check);
    return () => {
      window.removeEventListener(WORKFLOW_CHANGED, check);
      window.removeEventListener('storage', check);
    };
  }, [course, courseGuide, user]);

  // This is an unguided check using real, safe Operations controls. No
  // spotlight, Next button, or simulated click can pass it.
  useEffect(() => {
    if (!course || course.stage !== 'independent' || !independentAction) return;
    if (path !== independentAction.path) {
      router.push(independentAction.path);
      return;
    }
    const onInteraction = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) ||
        !independentActionMatches(independentAction, target, event.type as 'click'|'input')) return;
      setCourse(current => {
        if (!current || current.stage !== 'independent' ||
          current.lessonId !== course.lessonId || (current.independentStep || 0) !== (course.independentStep || 0)) return current;
        if ((current.independentStep || 0) === 0) return { ...current, independentStep: 1 };
        return { ...current, stage: 'done', independentStep: 0,
          passed: Array.from(new Set([...current.passed, current.lessonId])),
          metrics: { ...(current.metrics || {}), [current.lessonId]: {
            ...(current.metrics?.[current.lessonId] || {}), completedAt:new Date().toISOString(),
          } } };
      });
    };
    document.addEventListener(independentAction.type || 'click', onInteraction, true);
    return () => document.removeEventListener(independentAction.type || 'click', onInteraction, true);
  }, [course, independentAction, path, router]);

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
    // A tour is only the hands-on portion AFTER the mandatory explanation
    // and short quiz; authorized staff must also verify saved fictional work.
    if (course?.stage === 'tour' && course.lessonId === lessonId) {
      const kind = courseGuide?.handsOn;
      if (kind && capabilities.manage_department && (kind !== 'mt-light-fault' || capabilities.make_decisions)) {
        const reference = makeTrainingReference(kind);
        const session: TrainingWorkflowSession = {
          kind: kind as TrainingWorkflowKind, ownerId: workflowOwnerId(user),
          reference, step: 0, createdAt: new Date().toISOString(),
        };
        try {
          localStorage.setItem(workflowSessionKey(user), JSON.stringify(session));
          setCourse(current => current ? { ...current, stage: 'work', reference } : current);
          window.dispatchEvent(new Event(WORKFLOW_CHANGED));
          router.push(WORKFLOW_DEFINITIONS[kind].path);
        } catch {
          // Do not claim the practical passed if storage cannot persist it.
          setCourse(current => current ? { ...current, stage: 'tour' } : current);
          setHelpMessage('Training storage is unavailable. Please enable local storage and restart this practice.');
        }
      } else {
        setCourse(current => current ? {
          ...current, stage: 'independent', independentStep: 0,
        } : current);
      }
      return;
    }
    setMenuOpen(true);
    setHelpMessage('Tour viewed. Your course completion still requires the lesson, quiz and practical exercise.');
  }, [storageKey, course, courseGuide, capabilities.manage_department, capabilities.make_decisions, user, router]);

  const next = useCallback((fromActualClick = false) => {
    if (!active || !lesson) return;
    if (step?.requiresAction && (course?.stage === 'tour' || targetFound) && !fromActualClick) return;
    setHelpMessage('');
    setPosition(null);
    if (atLastStep) finish(lesson.id);
    else setActive({ id: lesson.id, index: active.index + 1 });
  }, [active, lesson, atLastStep, finish, step, targetFound, course?.stage]);

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
    // Pausing a practical never grants a pass. The course resumes at the tour.
  }, []);

  function startCurrentPractice() {
    if (!course || !courseLesson || course.stage !== 'quiz') return;
    setSelectedAnswer(null);
    setQuizFeedback('');
    setMenuOpen(false);
    setActive({ id: courseLesson.id, index: 0 });
    setCourse({ ...course, stage: 'tour', question: 0 });
    router.push(courseLesson.steps[0]?.path || '/');
  }

  function answerQuiz() {
    if (!course || !quizItem || selectedAnswer === null) return;
    if (selectedAnswer !== quizItem.correct) {
      setCourse(current => current ? { ...current, metrics: { ...(current.metrics || {}),
        [current.lessonId]: { ...(current.metrics?.[current.lessonId] || {}),
          incorrectAnswers: (current.metrics?.[current.lessonId]?.incorrectAnswers || 0) + 1 },
      } } : current);
      setQuizErrors(v => v + 1);
      setQuizFeedback(quizErrors === 0
        ? 'Not quite. Read the situation again. What would the next employee need to do, and what has actually been confirmed? Try again.'
        : 'Try again. ' + quizItem.explanation);
      setSelectedAnswer(null);
      return;
    }
    setQuizFeedback('');
    setQuizErrors(0);
    setSelectedAnswer(null);
    if (course.question < (currentQuestions?.length || 0) - 1) {
      setCourse({ ...course, question: course.question + 1 });
    } else startCurrentPractice();
  }

  function startNextLesson() {
    if (!course || course.stage !== 'done') return;
    const index = lessons.findIndex(item => item.id === course.lessonId);
    const nextLesson = lessons.slice(index + 1).find(item => !course.passed.includes(item.id))
      || lessons.find(item => !course.passed.includes(item.id));
    if (!nextLesson) { setCourse({ ...course, stage: 'finished' }); setMenuOpen(true); return; }
    setCourse({ ...course, lessonId: nextLesson.id, stage: 'learn', question: 0, independentStep: 0, reference: undefined });
    setSelectedAnswer(null);
    setQuizFeedback('');
    setMenuOpen(false);
  }

  function repeatCourseLesson(lessonId: string) {
    if (!lessons.some(item => item.id === lessonId)) return;
    setActive(null);
    setMenuOpen(false);
    setCourse(current => current ? { ...current, lessonId, stage: 'learn', question: 0, independentStep: 0, reference: undefined,
      metrics: { ...(current.metrics || {}), [lessonId]: { ...(current.metrics?.[lessonId] || {}),
        repeats: (current.metrics?.[lessonId]?.repeats || 0) + 1 } } } : {
      lessonId, stage: 'learn', question: 0, passed: [],
    });
    setSelectedAnswer(null);
    setQuizFeedback('');
  }

  const begin = useCallback((lessonId: string) => {
    setMenuOpen(false);
    setHelpMessage('');
    setPosition(null);
    setActive({ id: lessonId, index: 0 });
  }, []);

  useEffect(() => {
    if (active && (!lesson || !lessons.some(item => item.id === lesson.id))) exit();
  }, [active, lesson, lessons, exit]);

  useEffect(() => {
    if (!step || path === step.path) return;
    setTargetFound(false);
    setPosition(null);
    if (step.requiresAction) {
      // The trainee navigates using the actual link. Do not immediately
      // redirect them back to the previous page before the click advances.
      const destination = lesson?.steps[(active?.index ?? 0) + 1]?.path;
      if (destination && path === destination) next(true);
      return;
    }
    router.push(step.path);
  }, [path, router, step, lesson, active, next]);

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
    const click = () => { window.setTimeout(() => { if (document.body.contains(node) || step.advanceOnClick) next(true); }, 100); };
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

  useEffect(() => {
    if (!menuOpen) return;
    const library = libraryRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(library?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]'
    ) || []).filter(node => node.getClientRects().length > 0);
    const controls = focusable();
    (controls[0] || library)?.focus();

    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) { event.preventDefault(); library?.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!library?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', trapTab);
    return () => { window.removeEventListener('keydown', trapTab); previous?.focus(); };
  }, [menuOpen]);

  const spotlight = position && path === step?.path ? {
    top: Math.max(0, position.top - 6),
    left: Math.max(0, position.left - 6),
    width: position.width + 12,
    height: position.height + 12,
  } : null;

  return <>
    <button type="button" className="ops-guide-launch" data-testid="interactive-training-open"
      aria-label="Open interactive training" onClick={() => {
        if (course && ['learn', 'quiz'].includes(course.stage)) return;
        exit(); setMenuOpen(true);
      }}>
      <span aria-hidden="true">?</span> Training
    </button>

    {course && courseLesson && courseGuide && ['learn','quiz','done'].includes(course.stage) && <div
      className="ops-course-backdrop" data-testid="required-training-course">
      <section className="ops-course-panel" role="dialog" aria-modal="true" aria-label="Required training lesson">
        <div className="ops-course-heading"><span>HIDDEN OASIS · STAFF TRAINING</span>
          <strong>Lesson {lessonNumber} of {lessons.length}</strong></div>
        {capabilities.manage_department && <details className="ops-course-help">
          <summary>Supervisor: review trainee progress without skipping your own lesson</summary>
          <TrainerReports manager={user} />
        </details>}
        <div className="ops-course-progress" aria-label="Lesson stages"><span className={course.stage === 'learn' ? 'current' : ''}>1. Learn</span>
          <span className={course.stage === 'quiz' ? 'current' : ''}>2. Check understanding</span>
          <span className={course.stage === 'done' ? 'current' : ''}>3. Actual-page practice</span></div>
        {course.stage === 'learn' && <>
          <h2 data-testid="course-lesson-title">{courseLesson.title}</h2>
          <p className="ops-course-explanation">{courseGuide.explanation}</p>
          <h3>Example — what this looks like at work</h3>
          <p className="ops-course-example">{currentExample}</p>
          <h3>What not to do</h3>
          <p className="ops-course-wrong-example">{courseGuide.incorrectExample || 'Do not guess, invent a completed action, or mark work done without checking the facts.'}</p>
          <p><strong>Why that would be a problem:</strong> {courseGuide.whyIncorrect || 'Someone might rely on the wrong information or miss unfinished work. Always confirm what happened.'}</p>
          {courseGuide.branches?.[0] && <div className="ops-course-branch" data-testid="course-situation-branch">
            <h3>What if the situation changes?</h3>
            <p>{courseGuide.branches[0].question}</p>
            <div className="ops-course-choices">{courseGuide.branches[0].choices.map((option,i) =>
              <label key={option} className={branchAnswer===i?'selected':''}>
                <input type="radio" name="course-branch" checked={branchAnswer===i}
                  onChange={() => {setBranchAnswer(i);setBranchExplained(false);}} /> {option}
              </label>)}</div>
            {branchExplained && <p role="status">{branchAnswer===courseGuide.branches[0].correct?'Good thinking. ':'Think again: '}{courseGuide.branches[0].response}</p>}
            <button type="button" className="ops-course-quiet" disabled={branchAnswer===null}
              onClick={()=>setBranchExplained(true)}>Explain this situation</button>
          </div>}
          <p><strong>Remember:</strong> {courseGuide.remember}</p>
          <p className="ops-course-next-explainer">Next: Answer two short questions. Then practise on the actual fictional Operations pages. You must perform the actions yourself.</p>
          <details className="ops-course-help">
            <summary>Having trouble? Resume or restore on another computer</summary>
            <p>Close and reopen the app to continue on this device. If a practice form gets stuck, restart this lesson; previously finished lessons stay recorded. Export a report to keep a local copy. On another device, read-only lessons can be restored, but tasks and other saved work must be redone.</p>
            <label>Restore a report for this practice login
              <input type="file" accept=".json,application/json" onChange={event=>{void restoreTrainingProgress(event.target.files?.[0]);event.target.value='';}} />
            </label>
            {restoreMessage && <p role="status">{restoreMessage}</p>}
          </details>
          <button type="button" className="ops-course-primary" data-testid="course-start-quiz"
            onClick={() => { setCourse({ ...course, stage: 'quiz', question: 0 }); setQuizFeedback(''); }}>I understand — take the quiz →</button>
        </>}
        {course.stage === 'quiz' && quizItem && <>
          <h2>{courseLesson.title}</h2>
          <p className="ops-course-example">{currentExample}</p>
          <h3 data-testid="course-quiz-question">Question {course.question + 1} of {currentQuestions?.length || 2}: {quizItem.prompt}</h3>
          <div className="ops-course-choices">{quizItem.choices.map((answer, i) =>
            <label key={answer} className={selectedAnswer === i ? 'selected' : ''}>
              <input type="radio" name="course-answer" checked={selectedAnswer === i}
                onChange={() => { setSelectedAnswer(i); setQuizFeedback(''); }} />
              <span>{answer}</span>
            </label>)}</div>
          {quizFeedback && <p className="ops-course-feedback" role="alert">{quizFeedback}</p>}
          <button type="button" className="ops-course-primary" data-testid="course-check-answer"
            disabled={selectedAnswer === null} onClick={answerQuiz}>Check my answer →</button>
          <button type="button" className="ops-course-quiet" onClick={() => { setCourse({ ...course, stage: 'learn', question: 0 }); setSelectedAnswer(null); setQuizFeedback(''); }}>Read lesson again</button>
        </>}
        {course.stage === 'done' && <>
          <h2 data-testid="course-completed">Lesson {lessonNumber} completed</h2>
          <p>You finished the explanation, answered the quiz, and completed guided and independent practice on the actual fictional app pages{courseGuide.handsOn && course.reference ? ' with a verified saved record' : ''}.</p>
          <p>Done lessons can be repeated without removing earlier completion results.</p>
          <button type="button" className="ops-course-quiet" data-testid="export-training-report"
            onClick={exportTrainingProgress}>Export my progress report</button>
          <button type="button" className="ops-course-primary" data-testid="course-next-lesson"
            onClick={startNextLesson}>{lessonNumber < lessons.length ? 'Continue to Lesson ' + (lessonNumber + 1) + ' →' : 'Review completed lessons'}</button>
          <button type="button" className="ops-course-quiet" data-testid="course-repeat-lesson" onClick={() => repeatCourseLesson(course.lessonId)}>↻ Repeat this lesson</button>
        </>}
      </section>
    </div>}
    {course?.stage === 'tour' && !active && <div className="ops-course-backdrop">
      <section className="ops-course-panel" role="dialog" aria-modal="true" aria-label="Resume required training">
        <h2>Continue your actual-page practice</h2>
        <p>The lesson is not finished yet. Reopen the guided steps to practise on the real fictional Operations pages.</p>
        <button type="button" className="ops-course-primary" onClick={() => setActive({ id: course.lessonId, index: 0 })}>Resume practical lesson →</button>
      </section>
    </div>}
    {course?.stage === 'independent' && independentAction && <div className="ops-course-independent-status"
      data-testid="course-independent-challenge" role="status">
      <strong>Final practice · {1 + (course.independentStep || 0)} of 2 — No arrows</strong>
      <span>{independentAction.title}: {independentAction.instruction}</span>
      <small>You must use the real control on this page. Reading this instruction is not enough to pass.</small>
      <button type="button" onClick={() => router.push(independentAction.path)}>Take me to the correct screen</button>
      <button type="button" onClick={restartCurrentLessonSafely}>Restart this lesson from the beginning (no pass given)</button>
    </div>}
    {course?.stage === 'work' && <div className="ops-course-work-status" data-testid="course-await-work" role="status">
      <strong>Lesson {lessonNumber}: Actual-page practice</strong>
      <span>Follow the arrows on the real form. Save your fictional work, then use Check saved work. The next lesson unlocks only after verification.</span>
      <button type="button" className="ops-course-restart" onClick={restartCurrentLessonSafely}>Something is stuck? Restart this lesson safely</button>
    </div>}
    {menuOpen && !active && <div className="ops-guide-library-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <section ref={libraryRef} className="ops-guide-library" role="dialog" aria-modal="true" aria-label="Interactive staff training" tabIndex={-1}>
        <header className="ops-guide-library-header">
          <div><span className="ops-guide-eyebrow">OPERATIONS LEARNING CENTER</span><h2>Interactive training</h2><p>Follow highlighted controls on the real app. Your available lessons match your system permissions.</p></div>
          <button type="button" className="ops-guide-close" aria-label="Close training" onClick={() => setMenuOpen(false)}>×</button>
        </header>
        {helpMessage && <p className="ops-guide-success" role="status">{helpMessage}</p>}
        <p className="ops-guide-safety"><strong>Safe practice:</strong> Lessons never save, approve, or publish automatically. Use only an isolated demo workspace to submit fictional practice records.</p>
        <div className="ops-guide-course-summary" data-testid="course-progress-summary">
          <strong>{course?.passed.length || 0} of {lessons.length} lessons completed</strong>
          <p>Lessons are in order. Finished lessons can be repeated as often as needed.</p>
        </div>
        <div className="ops-guide-report-actions">
          <button type="button" className="ops-guide-repeat-course" data-testid="export-training-progress"
            onClick={exportTrainingProgress}>Export my training progress report</button>
          <label className="ops-course-import">Restore from report (same practice login)
            <input type="file" accept=".json,application/json" data-testid="restore-training-progress"
              onChange={event=>{void restoreTrainingProgress(event.target.files?.[0]);event.target.value='';}} />
          </label>
          <span>Exports can be shared with a trainer. Restoring only brings back read-only lesson history; saved-record skills require new practice on this device. This is not a certificate.</span>
          {restoreMessage && <p role="status" data-testid="restore-progress-feedback">{restoreMessage}</p>}
        </div>
        {capabilities.manage_department && <TrainerReports manager={user} />}
        <div className="ops-guide-lesson-grid">
          {lessons.map(item => <div key={item.id} className="ops-guide-lesson-wrap">
            <button type="button" className="ops-guide-lesson"
              disabled={Boolean(course && !course.passed.includes(item.id) && item.id !== course.lessonId)}
              onClick={() => {
                if (course && course.stage === 'finished' && course.passed.includes(item.id)) begin(item.id);
                else if (course) repeatCourseLesson(item.id);
                else begin(item.id);
              }}>
            <span className="ops-guide-lesson-title">{item.title}{course?.passed.includes(item.id) ? <span className="ops-guide-done">Lesson complete</span>
              : course?.lessonId === item.id ? <span className="ops-guide-done">Your current lesson</span>
              : course ? <span className="ops-guide-done">Locked until previous lesson</span>
              : complete.includes(item.id) ? <span className="ops-guide-done">Tour viewed</span> : null}</span>
            <span className="ops-guide-lesson-description">{item.summary}</span>
            <span className="ops-guide-lesson-meta">{item.steps.length} real-screen steps · {course?.passed.includes(item.id) ? 'Review practical tour' : 'Learn, quiz, then practise'}</span>
            </button>
            {course?.passed.includes(item.id) && <button type="button" className="ops-guide-repeat-course"
              onClick={() => repeatCourseLesson(item.id)}>↻ Repeat full lesson + quiz</button>}
          </div>)}
        </div>
        <p className="ops-guide-footer-note"><button type="button" className="ops-guide-more" onClick={() => { setMenuOpen(false); router.push('/training'); }}>Optional: situational decision practice and progress</button></p>
        <p className="ops-guide-footer-note">Lessons are in order. Staff must finish the short quiz and actual-screen practice before moving to the next lesson. Local markers are not staff certification.</p>
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
        aria-label={`Training step ${stepIndex + 1} of ${lesson.steps.length}`} style={popupStyle(position, tipPosition?.height)}>
        <div className="ops-guide-tip-top"><span>REAL-PAGE PRACTICE · STEP {stepIndex + 1} / {lesson.steps.length}</span><button type="button" onClick={exit} aria-label="Exit walkthrough">Pause ×</button></div>
        <div className="ops-guide-progress" aria-hidden="true"><span style={{ width: `${(stepIndex + 1) / lesson.steps.length * 100}%` }} /></div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {path !== step.path ? <p className="ops-guide-hint">Opening the correct page…</p>
          : !targetFound ? <p className="ops-guide-hint">This control is not visible yet. Check the page or continue to the next step.</p>
          : step.requiresAction ? <p className="ops-guide-hint">↖ Click the highlighted link yourself to continue. This is how you will navigate at work.</p>
          : step.advanceOnClick ? <p className="ops-guide-hint">↖ Click the highlighted control, or select Next to continue.</p>
          : <p className="ops-guide-hint">↖ Look at the highlighted area, then select Next.</p>}
        <div className="ops-guide-actions">
          <button type="button" className="ops-guide-button-secondary" onClick={previous} disabled={stepIndex === 0}>Back</button>
          <button type="button" className="ops-guide-button-primary" onClick={() => next()}
            disabled={Boolean(step.requiresAction && (course?.stage === 'tour' || targetFound))}>{step.requiresAction ? 'Click highlighted link →' : atLastStep ? 'Finish practice' : 'Next →'}</button>
        </div>
        <button type="button" className="ops-guide-more" onClick={() => { exit(); setMenuOpen(true); }}>Lesson list (progress stays)</button>
      </section>
    </>}
  </>;
}
