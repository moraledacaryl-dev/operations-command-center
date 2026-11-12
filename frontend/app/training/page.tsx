'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredUser } from '@/lib/session';
import { TrainingRecordLookup } from '@/components/TrainingRecordLookup';
import { TrainerReports } from '@/components/TrainerReports';
import { TrainingSpotlight } from '@/components/TrainingSpotlight';
import { scenarioCoachStage } from '@/lib/training-scenario-coach';
import { plainWordsForScenario } from '@/lib/training-plain-language';
import { TrainingNotificationPractice, readNotificationTraining, NOTIFICATION_TRAINING_CHANGED } from '@/components/TrainingNotificationPractice';
import type { NotificationTrainingEvidence } from '@/components/TrainingNotificationPractice';
import { readTrainingInspections, TASK_INSPECTION_CHANGED } from '@/lib/training-observations';
import type { TrainingInspectionEvidence } from '@/lib/training-observations';
import { Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import {
  makeTrainingReference, workflowOwnerId, workflowSessionKey, workflowResultsKey,
  WORKFLOW_CHANGED, WORKFLOW_DEFINITIONS,
} from '@/lib/training-workflows';
import type { TrainingWorkflowKind, TrainingWorkflowSession, TrainingWorkflowResults } from '@/lib/training-workflows';
import {
  assessPractice, DECISIONS, DEPARTMENTS, PRIORITIES,
  practiceScenariosFor,
} from '@/lib/practice-scenarios';
import type { PracticeAnswers, PracticeAssessment, PracticeField } from '@/lib/practice-scenarios';
import { parseScenarioProgress, parseWorkflowResults } from '@/lib/training-progress';
import { DRAFT_PREFIX, parseScenarioDrafts } from '@/lib/training-scenario-drafts';
import type { ScenarioDrafts } from '@/lib/training-scenario-drafts';
import type { ScenarioProgress } from '@/lib/training-progress';

type Phase = 'assess' | 'document' | 'complete';
type Reasoning = { consequence: string; timing: string };
const RISK_QUESTIONS = [
  { id: 'consequence' as const, title: '1. What could go wrong if nobody helps?',
    hint: 'Only think about what the story actually says. It is okay to say you are not sure.',
    choices: ['A person could get hurt', 'A guest may be left without something important',
      'It is a small problem that can wait', 'I am not sure yet; somebody needs to check'] },
  { id: 'timing' as const, title: '2. How soon should someone do something?',
    hint: 'Think about what happens if staff wait. Do not guess based on how angry the guest sounds.',
    choices: ['Right now — somebody might be in danger', 'During this shift — waiting may make it worse',
      'Later — it can be done at the usual time', 'Not sure — somebody needs to check first'] },
];
function riskClues(scenario: { context: readonly string[]; situation: string }): string[] {
  const facts = scenario.context.filter(item => !/^reference:/i.test(item.trim()));
  return facts.length ? facts.slice(0, 2) : [scenario.situation];
}
function reasoningFeedback(scenario: { context: readonly string[]; situation: string; priority: string }, chosen: string): string {
  const clue = riskClues(scenario)[0];
  const order = ['Routine', 'High', 'Critical'];
  const tooSlow = order.indexOf(chosen) < order.indexOf(scenario.priority);
  return 'Focus on this clue: “' + clue + '”. ' +
    (tooSlow ? 'What happens if staff leave this problem until the next day? Who needs to handle it before the guest is left waiting even longer?' :
      'Does the story actually say someone is in immediate danger? Or can the right team handle the problem promptly without treating it like an emergency?');
}
function reasoningDebrief(priority: string): string {
  if (priority === 'Critical') return 'Critical: Someone could be in danger, or a very serious situation needs a supervisor or manager immediately. Protect people and ask for help now.';
  if (priority === 'High') return 'High: This problem should not be left until later. Ask the right person to handle it soon, then check that it is being handled.';
  return 'Routine: From what we know, this is not dangerous and staff can handle it during normal planned work. If new information shows danger, treat it as more urgent.';
}
const STORAGE_PREFIX = 'ho-ops-scenario-practice-v1:';
const emptyAnswers: PracticeAnswers = { priority: '', department: '', decision: '', note: '', owner: '', followUp: '' };

export default function PracticeTrainingPage() {
  const router = useRouter();
  const [user, setUser] = useState<Entity | null>(null);
  const [activeId, setActiveId] = useState('');
  const [phase, setPhase] = useState<Phase>('assess');
  const [answers, setAnswers] = useState<PracticeAnswers>({ ...emptyAnswers });
  const [result, setResult] = useState<PracticeAssessment | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [progress, setProgress] = useState<ScenarioProgress>({});
  const [showTip, setShowTip] = useState(false);
  const [ready, setReady] = useState(false);
  const [verifiedWorkflows, setVerifiedWorkflows] = useState<TrainingWorkflowResults>({});
  const [recordInspections, setRecordInspections] = useState<TrainingInspectionEvidence[]>([]);
  const [notificationEvidence, setNotificationEvidence] = useState<NotificationTrainingEvidence | null>(null);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [levelFilter, setLevelFilter] = useState('All');
  const [guided, setGuided] = useState(true);
  const [guideMode, setGuideMode] = useState<'off' | 'welcome' | 'brief' | 'guided'>('off');
  const [hintsUsed, setHintsUsed] = useState(0);
  const [mistakesMade, setMistakesMade] = useState(0);
  const [reasoning, setReasoning] = useState<Reasoning>({ consequence: '', timing: '' });
  const [drafts, setDrafts] = useState<ScenarioDrafts>({});
  const [storageAvailable, setStorageAvailable] = useState(true);
  const exerciseHeading = useRef<HTMLHeadingElement | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return;
    const stored = getStoredUser();
    if (!stored) {
      router.replace('/login?next=/training');
      return;
    }
    setUser(stored);
    const key = STORAGE_PREFIX + String(stored.id || stored.email);
    try {
      const available = practiceScenariosFor(stored);
      const lastCase = localStorage.getItem(key + ':last');
      const id = available.find(s => s.id === lastCase)?.id || available[0]?.id || '';
      setActiveId(id);
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      const completed = parseScenarioProgress(saved, available.map(s => s.id));
      setProgress(completed);
      const restored = parseScenarioDrafts(
        JSON.parse(localStorage.getItem(DRAFT_PREFIX + String(stored.id || stored.email)) || '{}'), available);
      setDrafts(restored);
      const draft = restored[id];
      if (draft) {
        setAnswers(draft.answers);
        setPhase(draft.phase === 'complete' && !completed[id] ? 'document' : draft.phase);
        setAttempts(draft.attempts); setHintsUsed(draft.hintsUsed);
        setMistakesMade(draft.mistakesMade); setReasoning(draft.reasoning);
      }
    } catch { setStorageAvailable(false); setProgress({}); }
    try {
      if (!localStorage.getItem(key + ':guide-intro-v2')) setGuideMode('welcome');
    } catch { setGuideMode('welcome'); }
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!user || process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return;
    const load = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(workflowResultsKey(user)) || '{}');
        setVerifiedWorkflows(parseWorkflowResults(saved));
      } catch { setVerifiedWorkflows({}); }
    };
    load();
    window.addEventListener(WORKFLOW_CHANGED, load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener(WORKFLOW_CHANGED, load);
      window.removeEventListener('storage', load);
    };
  }, [user]);

  useEffect(() => {
    if (!user || process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return;
    const refresh = () => setRecordInspections(readTrainingInspections(user));
    refresh();
    window.addEventListener(TASK_INSPECTION_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(TASK_INSPECTION_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [user]);

  useEffect(() => {
    if (!user || process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return;
    const refresh = () => setNotificationEvidence(readNotificationTraining(user));
    refresh();
    window.addEventListener(NOTIFICATION_TRAINING_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(NOTIFICATION_TRAINING_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [user]);

  const scenarios = useMemo(() => practiceScenariosFor(user || {}), [user]);
  const filteredScenarios = useMemo(() => scenarios.filter(s => {
    if (departmentFilter !== 'All' && s.department !== departmentFilter) return false;
    if (levelFilter !== 'All' && String(s.level || 1) !== levelFilter) return false;
    const query = search.trim().toLowerCase();
    return !query || [s.title, s.situation, s.reference, s.skill || ''].some(v => v.toLowerCase().includes(query));
  }), [scenarios, departmentFilter, levelFilter, search]);
  const availableDepartments = useMemo(() => Array.from(new Set(scenarios.map(s => s.department))), [scenarios]);
  const myDepartments = useMemo(() => (user?.departments || []).map((d: Entity) => String(d.name || '')).filter((name: string, index: number, all: string[]) => name && all.indexOf(name) === index && availableDepartments.some(department => department === name)), [user, availableDepartments]);
  const totalErrors = scenarios.reduce((count, s) => count + (progress[s.id]?.mistakes || 0), 0);
  const selected = scenarios.find(s => s.id === activeId) || scenarios[0];
  const selectedId = selected?.id || '';
  const completedCount = scenarios.filter(s => progress[s.id]).length;
  const percent = scenarios.length ? Math.round(completedCount / scenarios.length * 100) : 0;
  const trainer = ['owner', 'admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const canCreateRecords = hasCapability(user, 'manage_department');
  // The real Fix verification endpoint requires decision authority.
  const canRunWorkflow = (kind: TrainingWorkflowKind) =>
    canCreateRecords && (!['mt-light-fault', 'fd-broken-shower'].includes(kind) ||
      hasCapability(user, 'make_decisions'));
  const workflowKind: TrainingWorkflowKind | null =
    selected?.id === 'guest-ac' || selected?.id === 'shared-no-owner' ||
    selected?.id === 'shift-unresolved' || selected?.id === 'mt-light-fault' ||
    selected?.id === 'manager-evidence' || selected?.id === 'fd-broken-shower'
      ? selected.id : null;
  const verifiedCount = Object.values(verifiedWorkflows).filter(result => result?.completedAt).length;

  // Keep answers for each fictional situation. A draft never proves competency.
  useEffect(() => {
    if (!ready || !user || !selectedId) return;
    const next = { ...drafts, [selectedId]: { answers, phase, attempts, hintsUsed, mistakesMade, reasoning } };
    try {
      localStorage.setItem(DRAFT_PREFIX + String(user.id || user.email), JSON.stringify(next));
      localStorage.setItem(STORAGE_PREFIX + String(user.id || user.email) + ':last', selectedId);
    } catch { setStorageAvailable(false); }
  }, [answers, attempts, drafts, hintsUsed, mistakesMade, phase, ready, reasoning, selectedId, user]);

  useEffect(() => { if (moved.current) exerciseHeading.current?.focus(); }, [selectedId, phase]);

  function switchScenario(id: string, restart = false) {
    if (!scenarios.some(s => s.id === id)) return;
    if (id === selectedId && !restart) return;
    const nextDrafts = { ...drafts, [selectedId]: { answers, phase, attempts, hintsUsed, mistakesMade, reasoning } };
    const draft = restart ? undefined : nextDrafts[id];
    if (restart) delete nextDrafts[id];
    setDrafts(nextDrafts);
    setActiveId(id);
    setPhase(draft?.phase || 'assess');
    setAnswers(draft?.answers || { ...emptyAnswers });
    setResult(null);
    setAttempts(draft?.attempts || 0);
    setShowTip(false);
    setHintsUsed(draft?.hintsUsed || 0);
    setMistakesMade(draft?.mistakesMade || 0);
    setReasoning(draft?.reasoning || { consequence: '', timing: '' });
    moved.current = true;
    setGuideMode(current => current === 'guided' || current === 'brief' ? 'brief' : current);
    if (user) {
      try { localStorage.setItem(STORAGE_PREFIX + String(user.id || user.email) + ':last', id); }
      catch { setStorageAvailable(false); }
    }
  }
  function markGuideSeen() {
    if (!user) return;
    try { localStorage.setItem(STORAGE_PREFIX + String(user.id || user.email) + ':guide-intro-v2', 'yes'); }
    catch { /* Browser storage is optional for onboarding, not a permission. */ }
  }
  function closeGuide() { markGuideSeen(); setGuideMode('off'); }
  function startGuide() { markGuideSeen(); setGuideMode('brief'); }
  function repeatGuide() { if (selected) { switchScenario(selected.id, true); markGuideSeen(); setGuideMode('brief'); } }
  function update<K extends PracticeField>(field: K, value: PracticeAnswers[K]) {
    setAnswers(current => ({ ...current, [field]: value }));
    setResult(null);
  }
  function triage(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setAttempts(n => n + 1);
    const report = assessPractice(selected, { ...answers, decision: selected.decision, note: selected.example });
    if (report.errors.priority || report.errors.department) {
      setMistakesMade(n => n + 1);
      setResult(report);
      return;
    }
    setResult(null);
    setPhase('document');
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setAttempts(n => n + 1);
    const report = assessPractice(selected, answers);
    setResult(report);
    if (!report.passed) {
      setMistakesMade(n => n + 1);
      return;
    }
    const key = STORAGE_PREFIX + String(user?.id || user?.email);
    const previous = progress[selected.id];
    const next = { ...progress, [selected.id]: {
      attempts: (previous?.attempts || 0) + attempts + 1,
      completedAt: new Date().toISOString(),
      // A repeat must not erase earlier corrections or hints from exported evidence.
      hints: (previous?.hints || 0) + hintsUsed,
      mistakes: (previous?.mistakes || 0) + mistakesMade,
      firstTry: (previous?.firstTry ?? true) && mistakesMade === 0 && hintsUsed === 0,
    } };
    setProgress(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* practice remains in memory */ }
    setPhase('complete');
  }
  function startWorkflow(kind: TrainingWorkflowKind) {
    // A normal staff identity must never get management privileges to satisfy a lesson.
    if (!user || !canRunWorkflow(kind) || selected?.id !== kind) return;
    const session: TrainingWorkflowSession = {
      kind,
      ownerId: workflowOwnerId(user),
      createdAt: new Date().toISOString(),
      reference: makeTrainingReference(kind),
      step: 0,
    };
    try {
      localStorage.setItem(workflowSessionKey(user), JSON.stringify(session));
      window.dispatchEvent(new Event(WORKFLOW_CHANGED));
      router.push(WORKFLOW_DEFINITIONS[kind].path);
    } catch {
      setResult({
        passed: false, score: 0,
        errors: { note: 'This computer cannot save a training session. Make sure local storage is available and retry.' },
      });
    }
  }

  function exportResults() {
    if (!user) return;
    // Each row is a self-reported, device-local learning result, not a signed
    // certification. Protect CSV readers from spreadsheet-formula injection.
    const cell = (value: string | number | boolean | null | undefined) => {
      let cleaned = String(value ?? '').replace(/\r|\n/g, ' ');
      if (/^[=+@-]/.test(cleaned.trimStart())) cleaned = "'" + cleaned;
      return '"' + cleaned.replace(/"/g, '""') + '"';
    };
    const rows: Array<Array<string | number | boolean>> = [[
      'record_type', 'case_id', 'department', 'level', 'completed_at',
      'attempts', 'hints', 'mistakes', 'unassisted', 'record_id',
      'related_record_id', 'verified_stages',
    ]];
    for (const scenario of scenarios) {
      const saved = progress[scenario.id];
      if (!saved) continue;
      rows.push(['scenario', scenario.id, scenario.department, scenario.level || 1,
        saved.completedAt, saved.attempts, saved.hints || 0, saved.mistakes || 0,
        Boolean(saved.firstTry), '', '', '']);
    }
    if (notificationEvidence) {
      rows.push(['staff-notification-read', 'notification-mark-read', 'Personal', 1,
        notificationEvidence.completedAt, '', '', '', '', notificationEvidence.notificationId,
        '', 'Notice read time']);
    }
    for (const record of recordInspections) {
      const category = {
        task: ['read-only-task-inspection', 'task-status-priority'],
        handover: ['read-only-handover-inspection', 'handover-status-urgency'],
        guest: ['read-only-guest-inspection', 'guest-status-urgency'],
        fix: ['read-only-fix-inspection', 'fix-status-urgency'],
      }[record.kind];
      rows.push([category[0], category[1], String(record.departmentId), 1,
        record.completedAt, '', '', '', '', record.recordId, '',
        record.kind === 'task' ? 'Saved status and priority' : 'Saved status and priority']);
    }
    for (const [kind, evidence] of Object.entries(verifiedWorkflows)) {
      if (!Object.prototype.hasOwnProperty.call(WORKFLOW_DEFINITIONS, kind) ||
        !evidence || typeof evidence !== 'object' ||
        typeof evidence.completedAt !== 'string' ||
        !Number.isSafeInteger(evidence.recordId) || evidence.recordId <= 0) continue;
      rows.push(['hands-on-workflow', kind, 'Training', 0, evidence.completedAt,
        '', '', '', '', evidence.recordId, evidence.relatedRecordId || '',
        Array.isArray(evidence.steps) ? evidence.steps.join(' / ') : '']);
    }
    const csv = rows.map(row => row.map(cell).join(',')).join('\n');
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'hidden-oasis-fictional-training-progress.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  function nextScenario() {
    if (!scenarios.length) return;
    const index = scenarios.findIndex(s => s.id === selectedId);
    const next = scenarios.find((s, i) => i > index && !progress[s.id]) ||
      scenarios.find(s => !progress[s.id]) ||
      scenarios[(index + 1) % scenarios.length];
    switchScenario(next.id);
  }

  const reasoningReady = Boolean(reasoning.consequence && reasoning.timing);
  const lessonStage = selected ? scenarioCoachStage(selected, phase, answers, result, !guided || reasoningReady, Boolean(reasoning.consequence)) : null;
  if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return <p>Hands-on training is available only inside the isolated fictional training application.</p>;
  if (!ready || !user || !selected) return <section className="practice-shell" aria-live="polite">Opening your practice lessons…</section>;
  return <div className="practice-shell" data-testid="scenario-training">
    <header className="practice-hero">
      <div>
        <p className="practice-eyebrow">HIDDEN OASIS / OPERATIONS TRAINING</p>
        <h1>Practice common work situations</h1>
        <p>Read a work situation. Choose what to do, then write a note for the next shift. You will see what you got right and what to check again.</p>
        <p className="practice-safe"><strong>FOR PRACTICE ONLY.</strong> Use made-up guest and staff details. Nothing here changes the resort&apos;s live records.</p>
        <p>Need to check a procedure? <Link href="/staff-guide">Open Staff Guide</Link> for published reference instructions. Training practice and policy acknowledgment are separate.</p>
      </div>
      <div className="practice-progress" aria-label={completedCount + ' of ' + scenarios.length + ' scenarios complete'}>
        <strong>{completedCount} / {scenarios.length}</strong>
        <span>Situations completed</span>
        <div className="practice-progress-bar"><span style={{ width: percent + '%' }} /></div>
        <details className="practice-progress-more"><summary>See more results</summary>
          <small>{percent}% of practice situations finished</small>
          <small>{totalErrors} corrections made</small>
          <small>{verifiedCount} saved-work exercise{verifiedCount === 1 ? '' : 's'} checked</small>
          <small>{recordInspections.length} record-reading exercise{recordInspections.length === 1 ? '' : 's'} finished</small>
          <small>{notificationEvidence ? 1 : 0} notification exercise finished</small>
        </details>
        <button type="button" className="practice-secondary practice-export" onClick={exportResults} disabled={!completedCount && !verifiedCount && !recordInspections.length && !notificationEvidence}>Save my results (CSV)</button>
      </div>
    </header>

    <section className="practice-start-here" data-testid="training-start-here">
      <div><strong>Start here</strong><p>First, learn where to click in the practice app. Then come back to try a work situation. The app will guide you through the steps.</p></div>
      <div className="practice-start-buttons">
        <Link href="/" className="practice-primary" data-testid="open-real-screens">1. Learn where to click →</Link>
        <button type="button" className="practice-secondary" data-testid="show-lesson-arrows" onClick={startGuide}>2. Show me how to answer</button>
        <button type="button" className="practice-secondary" data-testid="repeat-current-lesson" onClick={repeatGuide}>↻ Start this lesson again</button>
      </div>
    </section>
    {myDepartments.length > 0 && <section className="practice-start-here" aria-labelledby="my-job-practice-title">
      <div><strong id="my-job-practice-title">Practice for your work</strong><p>Choose your team to find situations you may meet on a shift.</p></div>
      <div className="practice-start-buttons">{myDepartments.map((department: string) => <button type="button" key={department} className="practice-secondary"
        onClick={() => {
          setDepartmentFilter(department); setSearch(''); setLevelFilter('All');
          const first = scenarios.find(s => s.department === department);
          if (first) switchScenario(first.id);
          document.getElementById('practice-situation-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}>Practice {department}</button>)}</div>
    </section>}
    {user && hasCapability(user, 'manage_department') && <section className="practice-start-here" aria-label="Staff training reports">
      <TrainerReports manager={user} />
    </section>}
    <section className="practice-start-here" data-testid="handbook-training-entry">
      <h2>Learn the Staff Handbook</h2>
      <p>Practice finding a policy, using Contents, searching for a topic, and understanding the reading confirmation. The exercise uses sample text and does not change real staff records.</p>
      <Link href="/staff-guide?practice=handbook" className="practice-primary">
        Start handbook practice →
      </Link>
    </section>

    <div className="practice-layout">
      <aside className="practice-catalog" id="practice-situation-list" aria-label="Choose a training scenario">
        <div className="practice-side-title"><h2>Choose a situation</h2><span>{user.name || 'Trainee'}</span></div>
        <div className="practice-filters">
          <label htmlFor="practice-search">Search situations
            <input id="practice-search" data-testid="scenario-search" type="search"
              placeholder="Search by problem or room…" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <label htmlFor="practice-department-filter">Department
            <select id="practice-department-filter" value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}>
              <option value="All">All departments</option>
              {availableDepartments.map(d => <option value={d} key={d}>{d}</option>)}
            </select>
          </label>
          <label htmlFor="practice-level-filter">Level
            <select id="practice-level-filter" value={levelFilter} onChange={event => setLevelFilter(event.target.value)}>
              <option value="All">All levels</option>
              {[1, 2, 3, 4, 5].map(n => <option value={String(n)} key={n}>Level {n}</option>)}
            </select>
          </label>
          <small>{filteredScenarios.length} situations available</small>
        </div>
        <div className="practice-scenarios">
          {filteredScenarios.length === 0 && <p className="practice-empty">No matching cases. Clear the search or choose All departments and All levels.</p>}
          {filteredScenarios.map((scenario, index) => <button key={scenario.id} type="button"
            data-testid={'scenario-' + scenario.id}
            aria-current={scenario.id === selectedId ? 'step' : undefined}
            className={'practice-scenario' + (scenario.id === selectedId ? ' selected' : '')}
            onClick={() => switchScenario(scenario.id)}>
            <span className="practice-scenario-number">{progress[scenario.id] ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <span><strong>{scenario.title}</strong><small>{scenario.department} · Level {scenario.level || 1} · {progress[scenario.id] ? 'Completed' : 'Not completed'}</small></span>
          </button>)}
        </div>
      </aside>

      <section className="practice-workspace" aria-live="polite" aria-label="Active training exercise">
        <div className="practice-topline"><span className="practice-department">{selected.department} · Level {selected.level || 1}</span><span>Fictional case · {selected.reference}</span></div>
        <div className="practice-help">
          <details>
            <summary>How to complete this practice</summary>
            <ol>
              <li>Read the situation. Notice what happened and what is still unknown.</li>
              <li>Choose how soon staff should act and which team can help.</li>
              <li>Choose the next action. Write what still needs to be done.</li>
              <li>For longer cases, name who is responsible and what they should check.</li>
              <li>If an answer needs a change, check it and try again.</li>
            </ol>
            <p><strong>Urgency means how soon someone needs to act.</strong> Routine = can wait for normal work; High = should be handled soon; Critical = somebody may be in danger, or another serious problem needs immediate help.</p>
            <p>Everything here is for practice. Nothing changes live resort records.</p>
          </details>
          <label className="practice-mode"><input type="checkbox" checked={guided} onChange={event => { setGuided(event.target.checked); setShowTip(false); }} /> Show helpful hints</label>
        </div>
        <div className="practice-three-stage" data-testid="scenario-three-stage" aria-label="How practice works">
          <details><summary>1. Show me an example</summary>
            <p>Different fictional example: A guest in Perch 1 asks for extra towels. Check whether Housekeeping was already told. Tell the right team, leave a clear next-shift note and confirm delivery before marking the request done.</p>
          </details>
          <div><strong>2. Try it with help</strong><p>Read the clues below. Use Need a hint? when you are unsure.</p></div>
          <div><strong>3. Your turn</strong><p>Choose what to do, then write a note in your own words. The app explains what you need to correct.</p></div>
        </div>
        {ready && !storageAvailable && <p role="alert" className="practice-notice">Practice drafts could not be saved on this device. Keep the page open or ask your trainer for help.</p>}
        <h2 ref={exerciseHeading} tabIndex={-1}>{selected.title}</h2>
        <p className="practice-situation">{selected.situation}</p>
        <p className="practice-skill"><strong>What you will practise:</strong> {selected.skill || 'Choosing the right next action'}</p>
        <div className="practice-case" data-testid="scenario-case-brief">
          <h3>What happened?</h3>
          <ul>{selected.context.map(fact => <li key={fact}>{fact}</li>)}</ul>
          <p><strong>What you need to do:</strong> {selected.goal}</p>
        </div>
        <section className="practice-simple-words" data-testid="training-simple-words" aria-label="Helpful words explained">
          <h3>Helpful words</h3>
          <p>You may see these words in the app.</p>
          <dl>{plainWordsForScenario(selected).map(item =>
            <div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl>
        </section>
        {workflowKind && <section className="practice-real-workflow" data-testid="real-workflow-invite">
          <strong>Try this in the practice app</strong>
          <p>Use the buttons and forms you will see at work. Open
            {({ 'guest-ac': ' Guest Matters', 'shared-no-owner': ' Tasks',
              'shift-unresolved': ' Shift Handover', 'mt-light-fault': ' Maintenance',
              'manager-evidence': ' Requests', 'fd-broken-shower': ' Guest Matters and Maintenance' } as const)[workflowKind]}.
            Create a practice record, update it, and check that it saved. Use made-up details only.</p>
          {verifiedWorkflows[workflowKind]
            ? <p className="practice-real-workflow-verified" role="status">
              ✓ The app checked this practice on {new Date(verifiedWorkflows[workflowKind]?.completedAt || '').toLocaleDateString('en-PH')}. You can repeat it.
            </p> : null}
          {canRunWorkflow(workflowKind)
            ? <button type="button" className="practice-primary" data-testid="start-real-workflow"
                onClick={() => startWorkflow(workflowKind)}>
                {verifiedWorkflows[workflowKind] ? 'Try this practice again' : 'Open practice screen'}</button>
            : <p className="practice-real-workflow-restricted">
                This login can read the lessons but cannot save or change records.
                {['mt-light-fault', 'fd-broken-shower'].includes(workflowKind)
                  ? 'A manager or owner practice login is needed to check the final step. You can still practise writing and passing on notes.'
                  : 'Ask your trainer for the correct supervisor or manager practice login. Your usual access will not change.'}
              </p>}
        </section>}

        <div className="practice-steps" aria-label="Exercise stages">
          <span className={phase === 'assess' ? 'current' : ''}>1. Choose who can help</span>
          <span className={phase === 'document' ? 'current' : ''}>2. Write the next step</span>
          <span className={phase === 'complete' ? 'current' : ''}>3. Feedback</span>
        </div>

        {phase === 'assess' && <form className="practice-form" onSubmit={triage} data-testid="scenario-triage">
          <p className="practice-instruction"><strong>Your turn — Step 1:</strong> Think about <strong>what could happen</strong> and <strong>how soon someone needs to help</strong>. Choose urgency and the team.</p>
          <section className="practice-judgment" data-testid="judgment-lens" aria-label="Two-question urgency guide">
            <h3>Check what matters most</h3>
            <p>Answer these two questions to help you choose the right urgency. These questions are not graded.</p>
            <div className="practice-judgment-facts"><strong>Things to check:</strong>
              <ul>{riskClues(selected).map(clue => <li key={clue}>{clue}</li>)}</ul>
            </div>
            {RISK_QUESTIONS.map(question => <fieldset key={question.id} data-testid={'judgment-' + question.id}>
              <legend>{question.title}</legend>
              <p>{question.hint}</p>
              <div className="practice-judgment-options">{question.choices.map(choice =>
                <label key={choice} className={reasoning[question.id] === choice ? 'chosen' : ''}>
                  <input type="radio" name={'risk-' + question.id} value={choice}
                    checked={reasoning[question.id] === choice}
                    onChange={() => setReasoning(current => ({ ...current, [question.id]: choice }))} />
                  <span>{choice}</span>
                </label>)}</div>
            </fieldset>)}
            <p role="status" className="practice-judgment-status">{reasoningReady
              ? 'Now choose the urgency below. Use what you noticed in the situation.'
              : 'First, think about what could happen. Then decide how long staff can safely wait.'}</p>
            <details><summary>Not sure? See examples</summary>
              <p><strong>Routine:</strong> This can wait until normal work hours. Example: updating next week&apos;s event checklist.</p>
              <p><strong>High:</strong> This needs attention soon. Example: a guest room cannot be used until a repair is checked.</p>
              <p><strong>Critical:</strong> Someone may be in danger. Example: water near an electrical outlet. Keep people away and call the right person immediately.</p>
              <p><strong>If safety is uncertain:</strong> If something may be dangerous, keep people safe and call a supervisor while the risk is checked.</p>
            </details>
          </section>
          <label>How soon should staff act?
            <select value={answers.priority} required onChange={e => update('priority', e.target.value as PracticeAnswers['priority'])} data-testid="scenario-priority">
              <option value="">Select urgency…</option>{PRIORITIES.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.priority && <><small className="practice-error" role="alert">{result.errors.priority}</small>
              <small className="practice-judgment-correction" data-testid="priority-feedback">{reasoningFeedback(selected, answers.priority)}</small></>}
          </label>
          <label>Which team should handle this next?
            <select value={answers.department} required onChange={e => update('department', e.target.value as PracticeAnswers['department'])} data-testid="scenario-department">
              <option value="">Select a team…</option>{DEPARTMENTS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.department && <small className="practice-error" role="alert">{result.errors.department}</small>}
          </label>
          {result && !result.passed && <p className="practice-notice" role="status">Check the situation again and change your answer. You can try as many times as needed.</p>}
          <div className="practice-actions"><button type="submit" className="practice-primary" data-testid="scenario-check-assessment">Check my choices →</button>
            {guided && <button type="button" className="practice-secondary" onClick={() => {
              if (!showTip) setHintsUsed(n => n + 1);
              setShowTip(value => !value);
            }}>{showTip ? 'Hide hint' : 'Need a hint?'}</button>}</div>
          {guided && showTip && <p className="practice-hint">Ask yourself: What happens if nobody acts? Could it get worse before the next shift? Who can help and give an update?</p>}
        </form>}

        {phase === 'document' && <form className="practice-form" onSubmit={submit} data-testid="scenario-document">
          <p className="practice-instruction">You chose the right urgency and team. Here is why:</p>
          <p className="practice-judgment-explanation" data-testid="priority-debrief">{reasoningDebrief(selected.priority)}</p>
          <p className="practice-instruction"><strong>Your turn — Step 2:</strong> Choose the next action. Then write a note the next employee can follow.</p>
          <label>Choose the next action
            <select value={answers.decision} required onChange={e => update('decision', e.target.value as PracticeAnswers['decision'])} data-testid="scenario-decision">
              <option value="">Select action…</option>{DECISIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.decision && <small className="practice-error" role="alert">{result.errors.decision}</small>}
          </label>
          {(selected.level || 1) >= 3 && <>
            <label>Who is responsible for this job?
              <input type="text" data-testid="scenario-owner" value={answers.owner || ''}
                placeholder="e.g., On-duty Maintenance lead"
                onChange={event => update('owner', event.target.value)} />
              <small>Use a job title, not a real employee&apos;s name.</small>
              {result?.errors.owner && <small className="practice-error" role="alert">{result.errors.owner}</small>}
            </label>
            <label>What should be checked next? Who will confirm it is done?
              <textarea data-testid="scenario-follow-up" value={answers.followUp || ''} rows={2}
                placeholder="e.g., Maintenance lead will inspect the fault and report verified repair status to Front Desk before room release."
                onChange={event => update('followUp', event.target.value)} />
              {result?.errors.followUp && <small className="practice-error" role="alert">{result.errors.followUp}</small>}
            </label>
          </>}
          <label>Write a note for the next shift
            <textarea data-testid="scenario-note" value={answers.note} rows={5} required minLength={45}
              placeholder={'Include ' + selected.reference + ', what happened, what staff should do next, and who should do it.'}
              onChange={e => update('note', e.target.value)} />
            <small>Include practice number <strong>{selected.reference}</strong>, what happened, the next action, and who will check it. Use made-up details.</small>
            {selected.noteChecks && <small>Make sure your note explains {selected.noteChecks.map(rule => rule.label).join(' and ')}. Write what the person should actually do.</small>}
            {result?.errors.note && <small className="practice-error" role="alert">{result.errors.note}</small>}
          </label>
          {result && !result.passed && <p className="practice-notice" role="status">Check the highlighted answers, make the changes, and try again.</p>}
          <div className="practice-actions">
            <button type="submit" className="practice-primary" data-testid="scenario-submit">Check my note</button>
            <button type="button" className="practice-secondary" onClick={() => { setResult(null); setPhase('assess'); }}>← Back to first step</button>
          </div>
        </form>}

        {phase === 'complete' && <section className="practice-success" role="status" data-testid="scenario-complete">
          <p className="practice-success-mark" aria-hidden="true">✓</p>
          <h3>Practice finished</h3>
          <p>You chose who should help, what to do next, and what the next shift needs to know.</p>
          <p><strong>Tries:</strong> {attempts} · <strong>Changes made:</strong> {mistakesMade} · <strong>Hints used:</strong> {hintsUsed}</p>
          <p><strong>Why this urgency fits:</strong> {reasoningDebrief(selected.priority)}</p>
          <p><strong>Why this response works:</strong> {selected.why}</p>
          <div className="practice-example"><strong>Example of a useful handover:</strong><p>{selected.example}</p></div>
          <p className="practice-disclaimer">This practice does not give permission to use or approve real resort records. A supervisor must still check your skills on the actual system.</p>
          <div className="practice-actions">
            <button type="button" className="practice-primary" data-testid="scenario-next" onClick={nextScenario}>Next situation →</button>
            <button type="button" className="practice-secondary" data-testid="scenario-repeat" onClick={() => switchScenario(selected.id, true)}>Repeat this situation</button>
          </div>
        </section>}
        <footer className="practice-footer">
          <span>Want to practise using the app screens?</span>
          <Link href="/">Open the practice app</Link>
          {trainer && <Link href="/review">Open fictional review queue</Link>}
        </footer>
      </section>
    </div>
    <section className="practice-extra-lessons" aria-label="Additional record-reading lessons">
      <h2>Extra practice: read saved records</h2>
      <p>These exercises are optional. You can do them after the main lesson.</p>
      <div className="practice-observation-grid" aria-label="Staff practical record-reading exercises">
        <TrainingRecordLookup user={user} kind="task" />
        <TrainingRecordLookup user={user} kind="handover" />
        <TrainingRecordLookup user={user} kind="guest" />
        <TrainingRecordLookup user={user} kind="fix" />
        <TrainingNotificationPractice user={user} />
      </div>
    </section>
    {guideMode === 'welcome' && <TrainingSpotlight
      title="Welcome! Start your first lesson"
      description="Open the practice app to learn where to click, or start with a work situation here. You will learn what to check before choosing an answer."
      stepLabel="YOUR FIRST CLICK" onNext={() => { markGuideSeen(); setGuideMode('brief'); }}
      nextLabel="Start guided lesson →" onClose={closeGuide} />}
    {guideMode === 'brief' && <TrainingSpotlight title="Step 1: Read the fictional case"
      description="Read what happened and what you need to do. Then we will decide how urgent it is."
      stepLabel="STEP 1 — READ" targets={[{ selector: '[data-testid="scenario-case-brief"]' }]}
      onNext={() => setGuideMode('guided')} nextLabel="Help me choose →" onClose={closeGuide} />}
    {guideMode === 'guided' && lessonStage && <TrainingSpotlight
      title={lessonStage.title} description={lessonStage.instruction}
      stepLabel={'STEP ' + lessonStage.position + ' OF ' + lessonStage.total}
      targets={[{ selector: lessonStage.target }]}
      onClose={closeGuide}
      {...(phase === 'complete' ? {
        onNext: nextScenario, nextLabel: 'Next lesson →',
        onRepeat: repeatGuide, repeatLabel: '↻ Repeat this lesson',
      } : {})} />}
  </div>;
}
