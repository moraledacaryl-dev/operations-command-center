'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { availableTrainingLessons, TRAINING_LESSONS } from '@/lib/interactive-training';
import type { TrainingStep } from '@/lib/interactive-training';
import { COURSE_GUIDES, COURSE_STORAGE_PREFIX, readCourseProgress } from '@/lib/training-course';
import type { CourseProgress } from '@/lib/training-course';
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
  const quizItem = courseGuide?.questions[course?.question || 0];
  const lessonNumber = lessons.findIndex(item => item.id === course?.lessonId) + 1;

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
          ? { ...current, stage: 'done', passed: Array.from(new Set([...current.passed, current.lessonId])) }
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
          ...current, stage: 'done', passed: Array.from(new Set([...current.passed, lessonId])),
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
    if (course.question < (courseGuide?.questions.length || 0) - 1) {
      setCourse({ ...course, question: course.question + 1 });
    } else startCurrentPractice();
  }

  function startNextLesson() {
    if (!course || course.stage !== 'done') return;
    const index = lessons.findIndex(item => item.id === course.lessonId);
    const nextLesson = lessons.slice(index + 1).find(item => !course.passed.includes(item.id))
      || lessons.find(item => !course.passed.includes(item.id));
    if (!nextLesson) { setCourse({ ...course, stage: 'finished' }); setMenuOpen(true); return; }
    setCourse({ ...course, lessonId: nextLesson.id, stage: 'learn', question: 0, reference: undefined });
    setSelectedAnswer(null);
    setQuizFeedback('');
    setMenuOpen(false);
  }

  function repeatCourseLesson(lessonId: string) {
    if (!lessons.some(item => item.id === lessonId)) return;
    setActive(null);
    setMenuOpen(false);
    setCourse(current => current ? { ...current, lessonId, stage: 'learn', question: 0, reference: undefined } : {
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

    {course && courseLesson && courseGuide &&
      (course.stage === 'done' || (['learn', 'quiz'].includes(course.stage) &&
        (path === '/' || course.stage === 'quiz' || course.passed.length > 0))) && <div
      className="ops-course-backdrop" data-testid="required-training-course">
      <section className="ops-course-panel" role="dialog" aria-modal="true" aria-label="Required training lesson">
        <div className="ops-course-heading"><span>HIDDEN OASIS · STAFF TRAINING</span>
          <strong>Lesson {lessonNumber} of {lessons.length}</strong></div>
        <div className="ops-course-progress" aria-label="Lesson stages"><span className={course.stage === 'learn' ? 'current' : ''}>1. Learn</span>
          <span className={course.stage === 'quiz' ? 'current' : ''}>2. Check understanding</span>
          <span className={course.stage === 'done' ? 'current' : ''}>3. Actual-page practice</span></div>
        {course.stage === 'learn' && <>
          <h2 data-testid="course-lesson-title">{courseLesson.title}</h2>
          <p className="ops-course-explanation">{courseGuide.explanation}</p>
          <h3>Example — what this looks like at work</h3>
          <p className="ops-course-example">{courseGuide.example}</p>
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
          <p className="ops-course-next-explainer">Next: Answer two short questions. When you get them right, the app automatically takes you to the real fictional Operations pages to practise.</p>
          <button type="button" className="ops-course-primary" data-testid="course-start-quiz"
            onClick={() => { setCourse({ ...course, stage: 'quiz', question: 0 }); setQuizFeedback(''); }}>I understand — take the quiz →</button>
        </>}
        {course.stage === 'quiz' && quizItem && <>
          <h2>{courseLesson.title}</h2>
          <p className="ops-course-example">{courseGuide.example}</p>
          <h3 data-testid="course-quiz-question">Question {course.question + 1} of {courseGuide.questions.length}: {quizItem.prompt}</h3>
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
          <p>You finished the explanation, answered the quiz, and completed the required practice on the actual fictional app pages{courseGuide.handsOn && course.reference ? ' with a verified saved record' : ''}.</p>
          <p>Done lessons can be repeated without removing earlier completion results.</p>
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
    {course?.stage === 'work' && <div className="ops-course-work-status" data-testid="course-await-work" role="status">
      <strong>Lesson {lessonNumber}: Actual-page practice</strong>
      <span>Follow the arrows on the real form. Save your fictional work, then use Check saved work. The next lesson unlocks only after verification.</span>
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
