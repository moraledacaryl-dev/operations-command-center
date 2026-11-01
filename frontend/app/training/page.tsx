'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredUser } from '@/lib/session';
import { TrainingRecordLookup } from '@/components/TrainingRecordLookup';
import { TrainingSpotlight } from '@/components/TrainingSpotlight';
import { scenarioCoachStage } from '@/lib/training-scenario-coach';
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
import type { ScenarioProgress } from '@/lib/training-progress';

type Phase = 'assess' | 'document' | 'complete';
type Reasoning = { consequence: string; timing: string };
const RISK_QUESTIONS = [
  { id: 'consequence' as const, title: '1. What is at stake if nobody acts?',
    hint: 'Only use what the report actually tells you. It is okay to be unsure.',
    choices: ['Someone could get hurt or exposed to danger', 'A guest or resort operation may be seriously affected',
      'A small inconvenience or planned task may remain unfinished', 'Not enough facts yet — someone must verify'] },
  { id: 'timing' as const, title: '2. What is the cost of waiting?',
    hint: 'Think about how quickly the situation could get worse, not how dramatic it sounds.',
    choices: ['Unsafe to wait — the danger may be immediate', 'This shift — delays could make it worse',
      'Normal work queue — no urgent consequence is established', 'Unknown — check the situation promptly'] },
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
    (tooSlow ? 'What could happen if everyone waits? Does this need an owner or immediate protection sooner?' :
      'Is actual immediate danger or exceptional escalation established, or is prompt follow-up enough?');
}
function reasoningDebrief(priority: string): string {
  if (priority === 'Critical') return 'Critical: protect people or escalate an exceptional risk immediately; do not leave it in the normal queue.';
  if (priority === 'High') return 'High: a significant guest or operational consequence calls for prompt action, clear ownership and a follow-up.';
  return 'Routine: the facts support normal planned work. Reassess if a real safety risk or urgent deadline emerges.';
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
      const lastCase = localStorage.getItem(key + ':last');
      if (lastCase) setActiveId(lastCase);
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      setProgress(parseScenarioProgress(saved, practiceScenariosFor(stored).map(s => s.id)));
    } catch { setProgress({}); }
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

  function switchScenario(id: string) {
    if (!scenarios.some(s => s.id === id)) return;
    setActiveId(id);
    setPhase('assess');
    setAnswers({ ...emptyAnswers });
    setResult(null);
    setAttempts(0);
    setShowTip(false);
    setHintsUsed(0);
    setMistakesMade(0);
    setReasoning({ consequence: '', timing: '' });
    setGuideMode(current => current === 'guided' || current === 'brief' ? 'brief' : current);
    if (user) {
      try { localStorage.setItem(STORAGE_PREFIX + String(user.id || user.email) + ':last', id); } catch { /* offline memory only */ }
    }
  }
  function markGuideSeen() {
    if (!user) return;
    try { localStorage.setItem(STORAGE_PREFIX + String(user.id || user.email) + ':guide-intro-v2', 'yes'); }
    catch { /* Browser storage is optional for onboarding, not a permission. */ }
  }
  function closeGuide() { markGuideSeen(); setGuideMode('off'); }
  function startGuide() { markGuideSeen(); setGuideMode('brief'); }
  function repeatGuide() { if (selected) { switchScenario(selected.id); markGuideSeen(); setGuideMode('brief'); } }
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
        '', 'saved read_at (backend read)']);
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
        record.kind === 'task' ? 'status / priority (backend read)' : 'status / urgency (backend read)']);
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
  if (!ready || !user || !selected) return <section className="practice-shell" aria-live="polite">Opening your fictional training exercises…</section>;
  return <div className="practice-shell" data-testid="scenario-training">
    <header className="practice-hero">
      <div>
        <p className="practice-eyebrow">HIDDEN OASIS / OPERATIONS TRAINING</p>
        <h1>Practice real decisions in a safe simulation</h1>
        <p>Read the situation, choose what you would do, write the handover and submit your response. The training checks your decisions and gives feedback.</p>
        <p className="practice-safe"><strong>FICTIONAL EXERCISES ONLY.</strong> Responses stay on this device and are not sent to the resort&apos;s production systems.</p>
      </div>
      <div className="practice-progress" aria-label={completedCount + ' of ' + scenarios.length + ' scenarios complete'}>
        <strong>{completedCount} / {scenarios.length}</strong>
        <span>Situations completed</span>
        <div className="practice-progress-bar"><span style={{ width: percent + '%' }} /></div>
        <small>{percent}% of your available practice cases</small>
        <small>{totalErrors} corrections recorded in completed cases</small>
        <small>{verifiedCount} real-workflow practice exercise{verifiedCount === 1 ? '' : 's'} verified</small>
        <small>{recordInspections.length} read-only record investigation{recordInspections.length === 1 ? '' : 's'} completed</small>
        <small>{notificationEvidence ? 1 : 0} staff notification action verified</small>
        <button type="button" className="practice-secondary practice-export" onClick={exportResults} disabled={!completedCount && !verifiedCount && !recordInspections.length && !notificationEvidence}>Export my results (CSV)</button>
      </div>
    </header>

    <section className="practice-start-here" data-testid="training-start-here">
      <div><strong>Start on the actual Operations screens</strong><p><strong>Recommended first:</strong> Use the real fictional dashboard, navigation, queues and forms with a guided arrow. Then return here to learn how to assess situations and make decisions.</p></div>
      <div className="practice-start-buttons">
        <Link href="/" className="practice-primary" data-testid="open-real-screens">1. Learn on actual app pages →</Link>
        <button type="button" className="practice-secondary" data-testid="show-lesson-arrows" onClick={startGuide}>2. Guide me through decisions</button>
        <button type="button" className="practice-secondary" data-testid="repeat-current-lesson" onClick={repeatGuide}>↻ Repeat current lesson</button>
      </div>
    </section>
    <div className="practice-layout">
      <aside className="practice-catalog" aria-label="Choose a training scenario">
        <div className="practice-side-title"><h2>Your practice cases</h2><span>{user.name || 'Trainee'}</span></div>
        <div className="practice-filters">
          <label htmlFor="practice-search">Find a situation
            <input id="practice-search" data-testid="scenario-search" type="search"
              placeholder="Search a problem, room or topic…" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <label htmlFor="practice-department-filter">Department
            <select id="practice-department-filter" value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}>
              <option value="All">All departments</option>
              {availableDepartments.map(d => <option value={d} key={d}>{d}</option>)}
            </select>
          </label>
          <label htmlFor="practice-level-filter">Difficulty
            <select id="practice-level-filter" value={levelFilter} onChange={event => setLevelFilter(event.target.value)}>
              <option value="All">All levels</option>
              {[1, 2, 3, 4, 5].map(n => <option value={String(n)} key={n}>Level {n}</option>)}
            </select>
          </label>
          <small>{filteredScenarios.length} situations shown · {scenarios.length} assigned to this role</small>
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
            <summary>New here? How to complete this lesson</summary>
            <ol>
              <li>Read the fictional situation, including what has <strong>not</strong> been confirmed.</li>
              <li>Choose its urgency and the department responsible for the next action.</li>
              <li>Choose an appropriate response and write what really needs to happen, not simply “done.”</li>
              <li>For harder cases, assign an owner and specify what must be checked next.</li>
              <li>Read any correction, try again, and continue after passing.</li>
            </ol>
            <p><strong>Urgency:</strong> Routine = normal planned work; High = prompt action or significant impact; Critical = immediate danger or escalation.</p>
            <p>Only fictional cases are used. Nothing you enter here changes production records.</p>
          </details>
          <label className="practice-mode"><input type="checkbox" checked={guided} onChange={event => { setGuided(event.target.checked); setShowTip(false); }} /> Guided practice (allow hints)</label>
        </div>
        <h2>{selected.title}</h2>
        <p className="practice-situation">{selected.situation}</p>
        <p className="practice-skill"><strong>Skill:</strong> {selected.skill || 'Basic operational judgment'} · {selected.level === 5 ? 'Advanced scenario' : 'Practice lesson'}</p>
        {workflowKind && <section className="practice-real-workflow" data-testid="real-workflow-invite">
          <strong>Practice this inside the real fictional Operations screens</strong>
          <p>Unlike the decision quiz, this exercise requires you to open the actual
            {({ 'guest-ac': ' Guest Matters', 'shared-no-owner': ' Tasks',
              'shift-unresolved': ' Shift Handover', 'mt-light-fault': ' Maintenance',
              'manager-evidence': ' Requests', 'fd-broken-shower': ' Guest Matters and Maintenance' } as const)[workflowKind]} module, create a real fictional record,
            change its status, and pass a read-back check of the saved data.</p>
          {verifiedWorkflows[workflowKind]
            ? <p className="practice-real-workflow-verified" role="status">
              ✓ Workflow verified on {new Date(verifiedWorkflows[workflowKind]?.completedAt || '').toLocaleDateString('en-PH')}. You can repeat it.
            </p> : null}
          {canRunWorkflow(workflowKind)
            ? <button type="button" className="practice-primary" data-testid="start-real-workflow"
                onClick={() => startWorkflow(workflowKind)}>
                {verifiedWorkflows[workflowKind] ? 'Repeat actual workflow practice' : 'Start actual workflow practice'}</button>
            : <p className="practice-real-workflow-restricted">
                This fictional account can read and respond to scenarios, but cannot create operational records.
                {['mt-light-fault', 'fd-broken-shower'].includes(workflowKind)
                  ? 'The final verification requires a Manager/Owner account with decision authority. Supervisors and Leads can still practise reporting and handover lessons.'
                  : 'A Supervisor, Lead, or Manager training account with department-edit authority is required. Your role permissions will not be bypassed.'}
              </p>}
        </section>}
        <div className="practice-case" data-testid="scenario-case-brief">
          <h3>Situation brief</h3>
          <ul>{selected.context.map(fact => <li key={fact}>{fact}</li>)}</ul>
          <p><strong>Your objective:</strong> {selected.goal}</p>
        </div>

        <div className="practice-steps" aria-label="Exercise stages">
          <span className={phase === 'assess' ? 'current' : ''}>1. Assess & route</span>
          <span className={phase === 'document' ? 'current' : ''}>2. Record & act</span>
          <span className={phase === 'complete' ? 'current' : ''}>3. Feedback</span>
        </div>

        {phase === 'assess' && <form className="practice-form" onSubmit={triage} data-testid="scenario-triage">
          <p className="practice-instruction">Before choosing an urgency label, work out <strong>what could happen</strong> and <strong>how long it is safe to wait</strong>. These questions teach the reasoning; they do not reveal the answer.</p>
          <section className="practice-judgment" data-testid="judgment-lens" aria-label="Two-question urgency guide">
            <h3>Spot the risk — think before picking a label</h3>
            <p>Read the clues and answer two short questions. They are not graded. You still decide the urgency yourself.</p>
            <div className="practice-judgment-facts"><strong>Look closely at these case facts:</strong>
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
              ? 'Good. Now choose the urgency below. Your reasoning helps you decide; it does not select an answer automatically.'
              : 'Start with what could happen. Then think about when waiting would become a problem.'}</p>
            <details><summary>Need the rule? Compare three different examples</summary>
              <p><strong>Routine:</strong> An ordinary, nonhazardous task can safely join the planned queue. Example: updating a future event checklist.</p>
              <p><strong>High:</strong> Significant guest or operations impact needs prompt attention and an accountable owner. Example: a room cannot be released until an essential repair is confirmed.</p>
              <p><strong>Critical:</strong> A potential immediate safety hazard or exceptional escalation calls for protective action now. Example: water near an outlet. Restrict access and notify qualified staff.</p>
              <p><strong>If safety is uncertain:</strong> Never assume a credible hazard is harmless. Protect people while an authorized person verifies the facts.</p>
            </details>
          </section>
          <label>Based on the facts, how urgent is it?
            <select value={answers.priority} required onChange={e => update('priority', e.target.value as PracticeAnswers['priority'])} data-testid="scenario-priority">
              <option value="">Select urgency…</option>{PRIORITIES.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.priority && <><small className="practice-error" role="alert">{result.errors.priority}</small>
              <small className="practice-judgment-correction" data-testid="priority-feedback">{reasoningFeedback(selected, answers.priority)}</small></>}
          </label>
          <label>Who should own the next action?
            <select value={answers.department} required onChange={e => update('department', e.target.value as PracticeAnswers['department'])} data-testid="scenario-department">
              <option value="">Select a team…</option>{DEPARTMENTS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.department && <small className="practice-error" role="alert">{result.errors.department}</small>}
          </label>
          {result && !result.passed && <p className="practice-notice" role="status">Not quite. Re-read the situation, adjust your choices and check again. Mistakes are part of practice.</p>}
          <div className="practice-actions"><button type="submit" className="practice-primary" data-testid="scenario-check-assessment">Check my assessment →</button>
            {guided && <button type="button" className="practice-secondary" onClick={() => {
              if (!showTip) setHintsUsed(n => n + 1);
              setShowTip(value => !value);
            }}>{showTip ? 'Hide hint' : 'Need a hint?'}</button>}</div>
          {guided && showTip && <p className="practice-hint">Try this: What is the credible consequence of doing nothing? Could the problem get worse before the next shift? Who can stop it, confirm the facts, and update the affected person? Use those clues rather than guessing from the label.</p>}
        </form>}

        {phase === 'document' && <form className="practice-form" onSubmit={submit} data-testid="scenario-document">
          <p className="practice-instruction">Your urgency and team choices were accepted. This is the reason behind the urgency:</p>
          <p className="practice-judgment-explanation" data-testid="priority-debrief">{reasoningDebrief(selected.priority)}</p>
          <p className="practice-instruction">Now choose an appropriate action and write a note the next shift could actually use.</p>
          <label>Choose the next action
            <select value={answers.decision} required onChange={e => update('decision', e.target.value as PracticeAnswers['decision'])} data-testid="scenario-decision">
              <option value="">Select action…</option>{DECISIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.decision && <small className="practice-error" role="alert">{result.errors.decision}</small>}
          </label>
          {(selected.level || 1) >= 3 && <>
            <label>Who is accountable for the next action?
              <input type="text" data-testid="scenario-owner" value={answers.owner || ''}
                placeholder="e.g., On-duty Maintenance lead"
                onChange={event => update('owner', event.target.value)} />
              <small>Write a fictional role or responsible position—not a real staff member’s personal details.</small>
              {result?.errors.owner && <small className="practice-error" role="alert">{result.errors.owner}</small>}
            </label>
            <label>What must be checked next, and how will the outcome be confirmed?
              <textarea data-testid="scenario-follow-up" value={answers.followUp || ''} rows={2}
                placeholder="e.g., Maintenance lead will inspect the fault and report verified repair status to Front Desk before room release."
                onChange={event => update('followUp', event.target.value)} />
              {result?.errors.followUp && <small className="practice-error" role="alert">{result.errors.followUp}</small>}
            </label>
          </>}
          <label>Write your fictional handover / incident note
            <textarea data-testid="scenario-note" value={answers.note} rows={5} required minLength={45}
              placeholder={'Include ' + selected.reference + ', what happened, the next action and follow-up owner.'}
              onChange={e => update('note', e.target.value)} />
            <small>Include <strong>{selected.reference}</strong>, what happened, the necessary intervention, and who verifies the outcome. Do not enter real guest details.</small>
            {selected.noteChecks && <small>In this exercise, your note needs to cover {selected.noteChecks.map(rule => rule.label).join(' and ')}. Explain concretely; general filler will not pass.</small>}
            {result?.errors.note && <small className="practice-error" role="alert">{result.errors.note}</small>}
          </label>
          {result && !result.passed && <p className="practice-notice" role="status">Your response needs changes. Review the highlighted guidance and submit again.</p>}
          <div className="practice-actions">
            <button type="submit" className="practice-primary" data-testid="scenario-submit">Submit practice response</button>
            <button type="button" className="practice-secondary" onClick={() => { setResult(null); setPhase('assess'); }}>← Back to assessment</button>
          </div>
        </form>}

        {phase === 'complete' && <section className="practice-success" role="status" data-testid="scenario-complete">
          <p className="practice-success-mark" aria-hidden="true">✓</p>
          <h3>Scenario completed</h3>
          <p>Your triage, ownership, action and fictional handover met the practice rubric.</p>
          <p><strong>Attempts:</strong> {attempts} · <strong>Corrections:</strong> {mistakesMade} · <strong>Hints:</strong> {hintsUsed}</p>
          <p><strong>Why this urgency fits:</strong> {reasoningDebrief(selected.priority)}</p>
          <p><strong>Why this response works:</strong> {selected.why}</p>
          <div className="practice-example"><strong>Example of a useful handover:</strong><p>{selected.example}</p></div>
          <p className="practice-disclaimer">This is a decision and documentation drill, not an official skill certification. Completing it does not demonstrate actual Operations record creation or approval. Real end-to-end application workflows still require separate hands-on assessment.</p>
          <div className="practice-actions">
            <button type="button" className="practice-primary" data-testid="scenario-next" onClick={nextScenario}>Next situation →</button>
            <button type="button" className="practice-secondary" data-testid="scenario-repeat" onClick={() => switchScenario(selected.id)}>Repeat this situation</button>
          </div>
        </section>}
        <footer className="practice-footer">
          <span>Want to see the actual screens, queues and forms after this simulation?</span>
          <Link href="/">Explore the fictional Operations workspace</Link>
          {trainer && <Link href="/review">Open fictional review queue</Link>}
        </footer>
      </section>
    </div>
    <section className="practice-extra-lessons" aria-label="Additional record-reading lessons">
      <h2>Extra practice — inspect real fictional records</h2>
      <p>These optional exercises are separate from your step-by-step scenario. Complete them whenever you are ready.</p>
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
      description="First use the real fictional Operations screens or start the decision lesson here. The lesson teaches you to look for risk clues before choosing an urgency level."
      stepLabel="YOUR FIRST CLICK" onNext={() => { markGuideSeen(); setGuideMode('brief'); }}
      nextLabel="Start guided lesson →" onClose={closeGuide} />}
    {guideMode === 'brief' && <TrainingSpotlight title="Step 1: Read the fictional case"
      description="Read this situation and the objective. Next, we will reason through the risks before choosing any answer."
      stepLabel="STEP 1 — READ" targets={[{ selector: '[data-testid="scenario-case-brief"]' }]}
      onNext={() => setGuideMode('guided')} nextLabel="Guide my thinking →" onClose={closeGuide} />}
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
