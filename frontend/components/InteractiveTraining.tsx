'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import { availableTrainingLessons, TRAINING_LESSONS } from '@/lib/interactive-training';
import type { TrainingStep } from '@/lib/interactive-training';
import { COURSE_STORAGE_PREFIX, TRAINING_CATCHUP_LESSONS, courseGuideFor, readCourseProgress } from '@/lib/training-course';
import { ROOM_PRACTICE_FINISHED } from '@/lib/training-room-mission';
import { SHIFT_PRACTICE_FINISHED } from '@/lib/training-shift-mission';
import { ROOM_ARRIVAL_FINISHED } from '@/components/RoomArrivalPractice';
import { PRACTICE_PLANS } from '@/lib/training-practice-plans';
import type { CourseProgress } from '@/lib/training-course';
import { INDEPENDENT_CHECKS, independentActionMatches } from '@/lib/training-independent';
import { buildTrainingReport, parseTrainingReport, portableLearningCredit } from '@/lib/training-progress-report';
import { TrainerReports } from '@/components/TrainerReports';
import { useTrainingDialogFocus } from '@/lib/training-dialog-focus';
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
  // Hands-on scenario and shift-challenge pages have their own instruction
  // panels. Never cover those practice controls with the required-course dialog.
  const onPracticeHome = path === '/training' || path.startsWith('/training/');
  const [menuOpen, setMenuOpen] = useState(false);
  const [paused, setPaused] = useState(false);
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
  const courseDialogRef = useRef<HTMLElement>(null);
  const [tipPosition, setTipPosition] = useState<Position | null>(null);
  const [helpMessage, setHelpMessage] = useState('');
  const identity = String(user.id || user.email || 'signed-in-user');
  const isFrontDeskStaff = String(user.role).toLowerCase() === 'staff' &&
    Array.isArray(user.departments) && user.departments.some((dept: Entity) =>
      String(dept.name || '').toLowerCase() === 'front desk');
  const storageKey = COMPLETION_PREFIX + identity;
  const courseKey = COURSE_STORAGE_PREFIX + identity;
  const latestLessons = useRef(lessons);
  latestLessons.current = lessons;
  const courseLesson = course && lessons.find(item => item.id === course.lessonId);
  const primaryDepartment = user.departments?.find((dept: Entity) => Number(dept.id) === Number(user.primary_department_id)) || user.departments?.[0];
  const courseGuide = courseLesson ? courseGuideFor(courseLesson.id, String(primaryDepartment?.name || ''), isFrontDeskStaff) : undefined;
  const basePlan = courseLesson ? PRACTICE_PLANS[courseLesson.id] : undefined;
  const practicePlan = basePlan && courseLesson?.id === 'room-arrivals' && isFrontDeskStaff
    ? { ...basePlan, goal: 'Record a practice arrival and departure, then try another room yourself.',
        show: 'Use Record check-in when a fictional guest arrives. Record checkout when the guest leaves the same room.',
        self: 'Complete check-in and checkout in two rooms. The first has an arrow; the second starts without one.',
        checks: 'Both saved stays and the recording login are checked in the isolated training database.' }
    : basePlan && courseLesson?.id === 'staff-rooms' && !isFrontDeskStaff
    ? { ...basePlan, goal: 'Find guest rooms and shared areas without changing guest records.',
        self: 'Switch between Guest rooms and Shared areas without arrows.',
        checks: 'The app checks filter clicks. Your supervisor can confirm you read the right room records.' }
    : basePlan && courseLesson?.id === 'staff-handover' && String(user.role).toLowerCase() === 'staff'
    ? { ...basePlan, goal: 'Read two actual fictional handovers, then identify the saved status.',
        self: 'Find a second handover without arrows and confirm its saved status.',
        checks: 'Your answer is checked against the record in the isolated training database.' }
    : basePlan;
  const repeatVariant = courseGuide?.repeatVariant && (course?.metrics?.[course?.lessonId || '']?.repeats || 0) % 2 === 1
    ? courseGuide.repeatVariant : undefined;
  const currentExample = repeatVariant?.example || courseGuide?.example;
  const currentQuestions = repeatVariant?.questions || courseGuide?.questions;
  const quizItem = currentQuestions?.[course?.question || 0];
  const courseModalOpen = Boolean(!onPracticeHome && !paused && course && (
    ['learn','quiz','done'].includes(course.stage) || (course.stage === 'tour' && !active)));
  useTrainingDialogFocus(courseDialogRef, courseModalOpen, `${course?.lessonId}:${course?.stage}:${course?.question}`);
  const lessonNumber = lessons.findIndex(item => item.id === course?.lessonId) + 1;
  const catchupLessons = course?.stage === 'finished'
    ? lessons.filter(item => !course.passed.includes(item.id) &&
        (TRAINING_CATCHUP_LESSONS as readonly string[]).includes(item.id))
    : [];

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
        stage:nextLesson?'learn':'finished', question:0, independentStep:0, tourStep:0,
        reference:undefined, passed:credits, metrics:report.metrics,
      }:current);
      setRestoreMessage('Lessons restored. Repeat any hands-on practice that needs saved work on this device.');
    } catch { setRestoreMessage('This file could not be read. Export a fresh training report and try again.'); }
  }

  function restartCurrentLessonSafely() {
    if (!course) return;
    if (course.stage==='work') {
      try { localStorage.removeItem(workflowSessionKey(user)); window.dispatchEvent(new Event(WORKFLOW_CHANGED)); }
      catch { /* Course cannot pass without saved work regardless. */ }
    }
    setActive(null); setMenuOpen(false); setQuizFeedback(''); setSelectedAnswer(null);
    setCourse({ ...course, stage:'learn', question:0, independentStep:0, tourStep:0, reference:undefined });
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
  const roomArrivalPractice = isFrontDeskStaff && course?.lessonId === 'room-arrivals';

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
    try { setPaused(localStorage.getItem(courseKey + ':paused') === 'true'); } catch { setPaused(false); }
  }, [courseKey]);

  useEffect(() => {
    if (!course) return;
    try { localStorage.setItem(courseKey, JSON.stringify(course));
      window.dispatchEvent(new Event('ho-training-course-changed')); } catch { /* no certificate */ }
  }, [courseKey, course]);

  // On role-specific drills, only the dedicated coach signals verified
  // completion after reading actual fictional records. Navigation is not proof.
  useEffect(() => {
    const complete = (lessonId: string, stage: 'room-practice' | 'shift-practice', hints = 0) =>
      setCourse(current => current?.lessonId === lessonId && current.stage === stage ? {
        ...current, stage: 'done',
        passed: Array.from(new Set([...current.passed, lessonId])),
        metrics: { ...(current.metrics || {}), [lessonId]: {
          ...(current.metrics?.[lessonId] || {}), completedAt: new Date().toISOString(),
          hintsViewed: (current.metrics?.[lessonId]?.hintsViewed || 0) + hints,
        } },
      } : current);
    const onRoom = () => complete('staff-rooms', 'room-practice');
    const onShift = () => complete('staff-handover', 'shift-practice');
    const onArrival = (event: Event) => {
      if (!isFrontDeskStaff) return;
      const hints = Number((event as CustomEvent).detail?.hints);
      setCourse(current => current?.lessonId === 'room-arrivals' && current.stage === 'independent' ? {
        ...current, stage: 'done',
        passed: Array.from(new Set([...current.passed, 'room-arrivals'])),
        metrics: { ...(current.metrics || {}), 'room-arrivals': {
          ...(current.metrics?.['room-arrivals'] || {}), completedAt: new Date().toISOString(),
          hintsViewed: (current.metrics?.['room-arrivals']?.hintsViewed || 0) +
            (Number.isInteger(hints) && hints > 0 ? hints : 0),
        } },
      } : current);
    };
    window.addEventListener(ROOM_PRACTICE_FINISHED, onRoom);
    window.addEventListener(SHIFT_PRACTICE_FINISHED, onShift);
    window.addEventListener(ROOM_ARRIVAL_FINISHED, onArrival);
    return () => {
      window.removeEventListener(ROOM_PRACTICE_FINISHED, onRoom);
      window.removeEventListener(SHIFT_PRACTICE_FINISHED, onShift);
      window.removeEventListener(ROOM_ARRIVAL_FINISHED, onArrival);
    };
  }, [isFrontDeskStaff]);

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
    if (!course || paused || roomArrivalPractice || course.stage !== 'independent' || !independentAction) return;
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
  }, [course, independentAction, path, router, paused, roomArrivalPractice]);

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
      // Bar staff may complete their own report. Other record-editing exercises
      // remain restricted to the existing authorized management roles.
      const barDepartment = (user.departments || []).find((d: { id?: string | number; name?: string }) => d.name === 'Bar');
      if (kind && (capabilities.manage_department || (kind === 'bar-report' && barDepartment))
          && (kind !== 'mt-light-fault' || capabilities.make_decisions)) {
        const reference = makeTrainingReference(kind);
        const session: TrainingWorkflowSession = {
          kind: kind as TrainingWorkflowKind, ownerId: workflowOwnerId(user),
          reference, step: 0, createdAt: new Date().toISOString(),
          ...(kind === 'bar-report' && barDepartment ? { departmentId: Number(barDepartment.id) } : {}),
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
    else {
      const nextIndex = active.index + 1;
      setActive({ id: lesson.id, index: nextIndex });
      if (course?.stage === 'tour' && course.lessonId === lesson.id)
        setCourse(current => current?.stage === 'tour' && current.lessonId === lesson.id
          ? { ...current, tourStep: nextIndex } : current);
    }
  }, [active, lesson, atLastStep, finish, step, targetFound, course?.stage, course?.lessonId]);

  const previous = useCallback(() => {
    if (!active) return;
    setPosition(null);
    setHelpMessage('');
    const priorIndex = Math.max(0, active.index - 1);
    setActive({ ...active, index: priorIndex });
    setCourse(current => current?.stage === 'tour' && current.lessonId === active.id
      ? { ...current, tourStep: priorIndex } : current);
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
    if (courseLesson.id === 'staff-handover' && String(user.role).toLowerCase() === 'staff') {
      setActive(null);
      setCourse({ ...course, stage: 'shift-practice', question: 0 });
      router.push('/shift');
      return;
    }
    if (courseLesson.id === 'staff-rooms' && isFrontDeskStaff) {
      setActive(null);
      setCourse({ ...course, stage: 'room-practice', question: 0 });
      router.push('/rooms');
      return;
    }
    setActive({ id: courseLesson.id, index: 0 });
    setCourse({ ...course, stage: 'tour', question: 0, tourStep: 0 });
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
    setCourse({ ...course, lessonId: nextLesson.id, stage: 'learn', question: 0, independentStep: 0, tourStep: 0, reference: undefined });
    setSelectedAnswer(null);
    setQuizFeedback('');
    setBranchAnswer(null);
    setBranchExplained(false);
    setMenuOpen(false);
  }

  function repeatCourseLesson(lessonId: string) {
    if (!lessons.some(item => item.id === lessonId)) return;
    setActive(null);
    setMenuOpen(false);
    setCourse(current => current ? { ...current, lessonId, stage: 'learn', question: 0, independentStep: 0, tourStep: 0, reference: undefined,
      metrics: { ...(current.metrics || {}), [lessonId]: { ...(current.metrics?.[lessonId] || {}),
        repeats: (current.metrics?.[lessonId]?.repeats || 0) + 1 } } } : {
      lessonId, stage: 'learn', question: 0, passed: [],
    });
    setSelectedAnswer(null);
    setQuizFeedback('');
    setBranchAnswer(null);
    setBranchExplained(false);
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
    if (!menuOpen || onPracticeHome) return;
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
  }, [menuOpen, onPracticeHome]);

  useEffect(() => {
    if (onPracticeHome && menuOpen) setMenuOpen(false);
    if (onPracticeHome && active) setActive(null);
  }, [onPracticeHome, menuOpen, active]);

  function setLessonPaused(value: boolean) {
    setPaused(value);
    try { localStorage.setItem(courseKey + ':paused', String(value)); } catch { /* In-memory pause still works. */ }
  }

  const spotlight = position && path === step?.path ? {
    top: Math.max(0, position.top - 6),
    left: Math.max(0, position.left - 6),
    width: position.width + 12,
    height: position.height + 12,
  } : null;

  // The separate scenario workspace is usable at any point in learning.
  // It cannot award required-course credit without the verified mission.
  if (onPracticeHome) return null;

  return <>
    {course?.stage === 'finished' && catchupLessons.length > 0 && !paused &&
      <div className="ops-course-catchup" role="status" data-testid="training-update-available">
        <div><strong>New lessons for your role</strong>
          <p>{catchupLessons.map(item => item.title).join(' · ')}. Your older lessons are still saved.</p></div>
        <button type="button" onClick={() => {
          setActive(null); setSelectedAnswer(null); setQuizFeedback('');
          setCourse(current => current ? { ...current, lessonId: catchupLessons[0].id,
            stage:'learn', question:0, independentStep:0, tourStep:0, reference:undefined } : current);
        }}>Start new lesson</button>
      </div>}
    <button type="button" className="ops-guide-launch" data-testid="interactive-training-open"
      aria-label={paused ? 'Resume lesson' : 'Open interactive training'} onClick={() => {
        if (paused) { setLessonPaused(false); return; }
        if (course && ['learn', 'quiz'].includes(course.stage)) return;
        exit(); setMenuOpen(true);
      }}>
      <span aria-hidden="true">?</span> {paused ? 'Resume lesson' : 'Training'}
    </button>

    {!paused && course && courseLesson && courseGuide && ['learn','quiz','done'].includes(course.stage) && <div
      className="ops-course-backdrop" data-testid="required-training-course">
      <section ref={courseDialogRef} tabIndex={-1} className="ops-course-panel" role="dialog" aria-modal="true" aria-label="Required training lesson">
        <div className="ops-course-heading"><span>HIDDEN OASIS · STAFF TRAINING</span>
          <strong>Lesson {lessonNumber} of {lessons.length}</strong></div>
        <button type="button" className="ops-course-quiet" onClick={() => setLessonPaused(true)}>Pause lesson</button>
        {capabilities.manage_department && <details className="ops-course-help">
          <summary>Supervisor: view staff training results</summary>
          <TrainerReports manager={user} />
        </details>}
        <div className="ops-course-progress" aria-label="Lesson stages"><span className={course.stage === 'learn' ? 'current' : ''}>1. Read</span>
          <span className={course.stage === 'quiz' ? 'current' : ''}>2. Answer</span>
          <span className={course.stage === 'done' ? 'current' : ''}>3. Try it</span></div>
        {course.stage === 'learn' && <>
          <h2 data-testid="course-lesson-title">{courseLesson.title}</h2>
          {practicePlan && <div className="ops-practice-learning-goal" data-testid="training-practice-goal">
            <strong>Your goal: {practicePlan.goal}</strong>
            <p>First we will show you where to go. Then you will try it with the highlighted buttons. Last, you will do two short checks on your own.</p>
            <p><strong>What you will see:</strong> {practicePlan.show}</p>
          </div>}
          <p className="ops-course-explanation">{courseGuide.explanation}</p>
          <h3>Example at work</h3>
          <p className="ops-course-example">{currentExample}</p>
          <h3>A mistake to avoid</h3>
          <p className="ops-course-wrong-example">{courseGuide.incorrectExample || 'Do not guess, invent a completed action, or mark work done without checking the facts.'}</p>
          <p><strong>Why it matters:</strong> {courseGuide.whyIncorrect || 'Check what happened before telling someone that the work is finished.'}</p>
          {courseGuide.branches?.[0] && <div className="ops-course-branch" data-testid="course-situation-branch">
            <h3>What would you do if this happened?</h3>
            <p>{courseGuide.branches[0].question}</p>
            <div className="ops-course-choices">{courseGuide.branches[0].choices.map((option,i) =>
              <label key={option} className={branchAnswer===i?'selected':''}>
                <input type="radio" name="course-branch" checked={branchAnswer===i}
                  onChange={() => {setBranchAnswer(i);setBranchExplained(false);}} /> {option}
              </label>)}</div>
            {branchExplained && <p role="status">{branchAnswer===courseGuide.branches[0].correct?'Good thinking. ':'Think again: '}{courseGuide.branches[0].response}</p>}
            <button type="button" className="ops-course-quiet" disabled={branchAnswer===null}
              onClick={()=>setBranchExplained(true)}>Check this answer</button>
          </div>}
          <p><strong>Remember:</strong> {courseGuide.remember}</p>
          <p className="ops-course-next-explainer">Next: Answer two questions. Then use the practice app yourself. Follow the arrows to find the right buttons.</p>
          <details className="ops-course-help">
            <summary>Need help with this lesson?</summary>
            <p>You can close the app and continue later on this computer. If a page gets stuck, restart the lesson. Finished lessons are kept. You can save your report as a backup. On a different computer, you can bring back lessons you read, but you must practise saved work again.</p>
            <label>Use a saved report for this login
              <input type="file" accept=".json,application/json" onChange={event=>{void restoreTrainingProgress(event.target.files?.[0]);event.target.value='';}} />
            </label>
            {restoreMessage && <p role="status">{restoreMessage}</p>}
          </details>
          <button type="button" className="ops-course-primary" data-testid="course-start-quiz"
            onClick={() => { setCourse({ ...course, stage: 'quiz', question: 0 }); setQuizFeedback(''); }}>Answer two questions →</button>
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
            disabled={selectedAnswer === null} onClick={answerQuiz}>Check answer →</button>
          <button type="button" className="ops-course-quiet" onClick={() => { setCourse({ ...course, stage: 'learn', question: 0 }); setSelectedAnswer(null); setQuizFeedback(''); }}>Read the lesson again</button>
        </>}
        {course.stage === 'done' && <>
          <h2 data-testid="course-completed">Lesson {lessonNumber} completed</h2>
          <p>You finished the lesson, answered the questions, and practised using the app{courseGuide.handsOn && course.reference ? ' with a verified saved record' : ''}.</p>
          <p>You can repeat this lesson at any time. Your earlier results will stay saved.</p>
          <button type="button" className="ops-course-quiet" data-testid="export-training-report"
            onClick={exportTrainingProgress}>Save my training report</button>
          <button type="button" className="ops-course-primary" data-testid="course-next-lesson"
            onClick={startNextLesson}>{lessonNumber < lessons.length ? 'Go to Lesson ' + (lessonNumber + 1) + ' →' : 'See finished lessons'}</button>
          <button type="button" className="ops-course-quiet" data-testid="course-repeat-lesson" onClick={() => repeatCourseLesson(course.lessonId)}>↻ Repeat this lesson</button>
        </>}
      </section>
    </div>}
    {!paused && course?.stage === 'tour' && !active && <div className="ops-course-backdrop">
      <section ref={courseDialogRef} tabIndex={-1} className="ops-course-panel" role="dialog" aria-modal="true" aria-label="Resume required training">
        <button type="button" className="ops-course-quiet" onClick={() => setLessonPaused(true)}>Pause lesson</button>
        <h2>Continue your actual-page practice</h2>
        <p>You still have steps to finish. Open the practice screen and follow the arrows. Your place in the lesson is saved.</p>
        <button type="button" className="ops-course-primary" onClick={() => {
          const index = Math.min(courseLesson?.steps.length ? courseLesson.steps.length - 1 : 0, course.tourStep || 0);
          setActive({ id: course.lessonId, index });
          router.push(courseLesson?.steps[index]?.path || '/');
        }}>Resume step {(course.tourStep || 0) + 1} →</button>
      </section>
    </div>}
    {!paused && course?.stage === 'independent' && !roomArrivalPractice && independentAction && <div className="ops-course-independent-status"
      data-testid="course-independent-challenge" role="status">
      <strong>Your turn · {1 + (course.independentStep || 0)} of 2 — No arrows</strong>
      {practicePlan && <p className="ops-practice-self-goal">{practicePlan.self}</p>}
      <span>{independentAction.title}: {independentAction.instruction}</span>
      <small>Find and click the real control. The next step appears when your action is recognized. Nothing is saved or approved automatically.</small>
      {practicePlan && <details className="ops-practice-show-help" data-testid="independent-practice-help">
        <summary>Need help finding it?</summary>
        <p>{practicePlan.help}</p><p>{practicePlan.checks}</p>
        <p>{practicePlan.safety}</p>
        <p>On a phone, open the menu first if the link is hidden.</p>
      </details>}
      <button type="button" onClick={() => router.push(independentAction.path)}>Open the right screen</button>
      <button type="button" onClick={restartCurrentLessonSafely}>Start this lesson again</button>
    </div>}
    {course?.stage === 'work' && <div className="ops-course-work-status" data-testid="course-await-work" role="status">
      <strong>Lesson {lessonNumber}: Actual-page practice — save your work</strong>
      {practicePlan && <p className="ops-practice-self-goal">{practicePlan.goal}</p>}
      <span>Follow the arrows, make the fictional record on the actual practice screen, and select Check saved work. A form that is not saved cannot pass.</span>
      {practicePlan && <details className="ops-practice-show-help" data-testid="saved-work-practice-help">
        <summary>Need help with this practice?</summary><p>{practicePlan.help}</p><p>{practicePlan.checks}</p>
      </details>}
      <button type="button" className="ops-course-restart" onClick={restartCurrentLessonSafely}>Page not working? Start lesson again</button>
    </div>}
    {menuOpen && !active && <div className="ops-guide-library-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMenuOpen(false); }}>
      <section ref={libraryRef} className="ops-guide-library" role="dialog" aria-modal="true" aria-label="Interactive staff training" tabIndex={-1}>
        <header className="ops-guide-library-header">
          <div><span className="ops-guide-eyebrow">HIDDEN OASIS · STAFF TRAINING</span><h2>Interactive training</h2><p>Choose a lesson. Follow the arrows and practise on the same screens you will use at work.</p></div>
          <button type="button" className="ops-guide-close" aria-label="Close training" onClick={() => setMenuOpen(false)}>×</button>
        </header>
        {helpMessage && <p className="ops-guide-success" role="status">{helpMessage}</p>}
        <p className="ops-guide-safety"><strong>Practice only:</strong> Use made-up details. The lessons do not approve or publish anything for you, and nothing here changes live resort records.</p>
        <div className="ops-guide-course-summary" data-testid="course-progress-summary">
          <strong>{course?.passed.length || 0} of {lessons.length} lessons completed</strong>
          <p>Start with your current lesson. You can repeat finished lessons whenever you want.</p>
        </div>
        <div className="ops-guide-report-actions">
          <button type="button" className="ops-guide-repeat-course" data-testid="export-training-progress"
            onClick={exportTrainingProgress}>Save my training report</button>
          <label className="ops-course-import">Open a saved report (same login)
            <input type="file" accept=".json,application/json" data-testid="restore-training-progress"
              onChange={event=>{void restoreTrainingProgress(event.target.files?.[0]);event.target.value='';}} />
          </label>
          <span>You can show the report to your trainer. It only brings back lessons you read; you must repeat saved-work practice on this computer. The report is not an approval to work on live records.</span>
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
              : course?.lessonId === item.id ? <span className="ops-guide-done">Start here</span>
              : course ? <span className="ops-guide-done">Finish the earlier lesson first</span>
              : complete.includes(item.id) ? <span className="ops-guide-done">Tour viewed</span> : null}</span>
            <span className="ops-guide-lesson-description">{item.summary}</span>
            <span className="ops-guide-lesson-meta">{item.steps.length} steps · {course?.passed.includes(item.id) ? 'See the steps again' : 'Read, answer, then try'}</span>
            </button>
            {course?.passed.includes(item.id) && <button type="button" className="ops-guide-repeat-course"
              onClick={() => repeatCourseLesson(item.id)}>↻ Repeat lesson</button>}
          </div>)}
        </div>
        <div className="ops-guide-course-summary" data-testid="handbook-training-shortcut">
          <strong>Staff Handbook — guided practice</strong>
          <p>Try the real handbook controls with an example document: find a rule, use Contents, and practise confirmation.</p>
          <button type="button" className="ops-guide-repeat-course" onClick={() => {
            setMenuOpen(false);
            router.push('/staff-guide?practice=handbook');
          }}>Practise using the handbook</button>
        </div>
        <p className="ops-guide-footer-note"><button type="button" className="ops-guide-more" onClick={() => { setMenuOpen(false); router.push('/training'); }}>More practice: work situations</button></p>
        <p className="ops-guide-footer-note">Finish each lesson and its practice before moving on. A training report is not approval to work on live records.</p>
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
        <div className="ops-guide-tip-top"><span>FOLLOW THE ARROW · STEP {stepIndex + 1} OF {lesson.steps.length}</span><button type="button" onClick={exit} aria-label="Exit walkthrough">Pause ×</button></div>
        <div className="ops-guide-progress" aria-hidden="true"><span style={{ width: `${(stepIndex + 1) / lesson.steps.length * 100}%` }} /></div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {stepIndex === 0 && course?.stage === 'tour' && practicePlan &&
          <p className="ops-guide-practice-context"><strong>Practice goal:</strong> {practicePlan.goal}</p>}
        {path !== step.path ? <p className="ops-guide-hint">Opening the correct page…</p>
          : !targetFound ? <p className="ops-guide-hint">The button is not showing yet. Check that you are on the right page.</p>
          : step.requiresAction ? <p className="ops-guide-hint">↖ Click the highlighted link to continue.</p>
          : step.advanceOnClick ? <p className="ops-guide-hint">↖ Click the highlighted button, or choose Next.</p>
          : <p className="ops-guide-hint">↖ Look where the arrow points, then choose Next.</p>}
        <div className="ops-guide-actions">
          <button type="button" className="ops-guide-button-secondary" onClick={previous} disabled={stepIndex === 0}>Back</button>
          <button type="button" className="ops-guide-button-primary" onClick={() => next()}
            disabled={Boolean(step.requiresAction && (course?.stage === 'tour' || targetFound))}>{step.requiresAction ? 'Click highlighted link →' : atLastStep ? 'Finish practice' : 'Next →'}</button>
        </div>
        <button type="button" className="ops-guide-more" onClick={() => { exit(); setMenuOpen(true); }}>See lesson list</button>
      </section>
    </>}
  </>;
}
