'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredUser } from '@/lib/session';
import { Entity } from '@/lib/api';
import {
  assessPractice, DECISIONS, DEPARTMENTS, PRIORITIES,
  practiceScenariosFor,
} from '@/lib/practice-scenarios';
import type { PracticeAnswers, PracticeAssessment, PracticeField } from '@/lib/practice-scenarios';

type Phase = 'assess' | 'document' | 'complete';
type SavedProgress = Record<string, { attempts: number; completedAt: string }>;
const STORAGE_PREFIX = 'ho-ops-scenario-practice-v1:';
const emptyAnswers: PracticeAnswers = { priority: '', department: '', decision: '', note: '' };

export default function PracticeTrainingPage() {
  const router = useRouter();
  const [user, setUser] = useState<Entity | null>(null);
  const [activeId, setActiveId] = useState('');
  const [phase, setPhase] = useState<Phase>('assess');
  const [answers, setAnswers] = useState<PracticeAnswers>({ ...emptyAnswers });
  const [result, setResult] = useState<PracticeAssessment | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [progress, setProgress] = useState<SavedProgress>({});
  const [showTip, setShowTip] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace('/login?next=/training');
      return;
    }
    setUser(stored);
    const key = STORAGE_PREFIX + String(stored.id || stored.email);
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) setProgress(saved);
    } catch { setProgress({}); }
    setReady(true);
  }, [router]);

  const scenarios = useMemo(() => practiceScenariosFor(user || {}), [user]);
  const selected = scenarios.find(s => s.id === activeId) || scenarios[0];
  const selectedId = selected?.id || '';
  const completedCount = scenarios.filter(s => progress[s.id]).length;
  const percent = scenarios.length ? Math.round(completedCount / scenarios.length * 100) : 0;
  const trainer = ['owner', 'admin', 'manager'].includes(String(user?.role || '').toLowerCase());

  function switchScenario(id: string) {
    if (!scenarios.some(s => s.id === id)) return;
    setActiveId(id);
    setPhase('assess');
    setAnswers({ ...emptyAnswers });
    setResult(null);
    setAttempts(0);
    setShowTip(false);
  }
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
    if (!report.passed) return;
    const key = STORAGE_PREFIX + String(user?.id || user?.email);
    const next = { ...progress, [selected.id]: { attempts: attempts + 1, completedAt: new Date().toISOString() } };
    setProgress(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* practice remains in memory */ }
    setPhase('complete');
  }
  function nextScenario() {
    if (!scenarios.length) return;
    const index = scenarios.findIndex(s => s.id === selectedId);
    const next = scenarios.find((s, i) => i > index && !progress[s.id]) ||
      scenarios.find(s => !progress[s.id]) ||
      scenarios[(index + 1) % scenarios.length];
    switchScenario(next.id);
  }

  if (!ready || !user || !selected) return <section className="practice-shell" aria-live="polite">Opening your fictional training exercises…</section>;
  return <div className="practice-shell" data-testid="scenario-training">
    <header className="practice-hero">
      <div>
        <p className="practice-eyebrow">HIDDEN OASIS / OPERATIONS TRAINING</p>
        <h1>Practice real decisions in a safe simulation</h1>
        <p>Read the situation, choose what you would do, write the handover and submit your response. The training checks your decisions and gives feedback.</p>
        <p className="practice-safe"><strong>FICTIONAL EXERCISES ONLY.</strong> Responses stay on this device and are not sent to the resort's production systems.</p>
      </div>
      <div className="practice-progress" aria-label={completedCount + ' of ' + scenarios.length + ' scenarios complete'}>
        <strong>{completedCount} / {scenarios.length}</strong>
        <span>Situations completed</span>
        <div className="practice-progress-bar"><span style={{ width: percent + '%' }} /></div>
        <small>{percent}% of your available practice cases</small>
      </div>
    </header>

    <div className="practice-layout">
      <aside className="practice-catalog" aria-label="Choose a training scenario">
        <div className="practice-side-title"><h2>Your practice cases</h2><span>{user.name || 'Trainee'}</span></div>
        <div className="practice-scenarios">
          {scenarios.map((scenario, index) => <button key={scenario.id} type="button"
            data-testid={'scenario-' + scenario.id}
            aria-current={scenario.id === selectedId ? 'step' : undefined}
            className={'practice-scenario' + (scenario.id === selectedId ? ' selected' : '')}
            onClick={() => switchScenario(scenario.id)}>
            <span className="practice-scenario-number">{progress[scenario.id] ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <span><strong>{scenario.title}</strong><small>{scenario.department} · {progress[scenario.id] ? 'Completed' : 'Try this situation'}</small></span>
          </button>)}
        </div>
      </aside>

      <section className="practice-workspace" aria-live="polite" aria-label="Active training exercise">
        <div className="practice-topline"><span className="practice-department">{selected.department}</span><span>Fictional case · {selected.reference}</span></div>
        <h2>{selected.title}</h2>
        <p className="practice-situation">{selected.situation}</p>
        <div className="practice-case">
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
          <p className="practice-instruction">Decide how urgent this case is and which team should take ownership. Select both answers before continuing.</p>
          <label>How urgent is it?
            <select value={answers.priority} required onChange={e => update('priority', e.target.value as PracticeAnswers['priority'])} data-testid="scenario-priority">
              <option value="">Select urgency…</option>{PRIORITIES.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.priority && <small className="practice-error" role="alert">{result.errors.priority}</small>}
          </label>
          <label>Who should own the next action?
            <select value={answers.department} required onChange={e => update('department', e.target.value as PracticeAnswers['department'])} data-testid="scenario-department">
              <option value="">Select a team…</option>{DEPARTMENTS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.department && <small className="practice-error" role="alert">{result.errors.department}</small>}
          </label>
          {result && !result.passed && <p className="practice-notice" role="status">Not quite. Re-read the situation, adjust your choices and check again. Mistakes are part of practice.</p>}
          <div className="practice-actions"><button type="submit" className="practice-primary">Check my assessment →</button>
            <button type="button" className="practice-secondary" onClick={() => setShowTip(value => !value)}>{showTip ? 'Hide hint' : 'Need a hint?'}</button></div>
          {showTip && <p className="practice-hint">Think about risk to the guest, operational impact and who can take the next concrete action. You can try as many times as needed.</p>}
        </form>}

        {phase === 'document' && <form className="practice-form" onSubmit={submit} data-testid="scenario-document">
          <p className="practice-instruction">You chose the right priority and team. Now make the operational decision and write a note the next shift could actually use.</p>
          <label>Choose the next action
            <select value={answers.decision} required onChange={e => update('decision', e.target.value as PracticeAnswers['decision'])} data-testid="scenario-decision">
              <option value="">Select action…</option>{DECISIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            {result?.errors.decision && <small className="practice-error" role="alert">{result.errors.decision}</small>}
          </label>
          <label>Write your fictional handover / incident note
            <textarea data-testid="scenario-note" value={answers.note} rows={5} required minLength={45}
              placeholder={'Include ' + selected.reference + ', what happened, the next action and follow-up owner.'}
              onChange={e => update('note', e.target.value)} />
            <small>Include reference <strong>{selected.reference}</strong>. Use at least 45 characters. Do not enter real guest names or contact details.</small>
            {result?.errors.note && <small className="practice-error" role="alert">{result.errors.note}</small>}
          </label>
          {result && !result.passed && <p className="practice-notice" role="status">Your response needs changes. Review the highlighted guidance and submit again.</p>}
          <div className="practice-actions">
            <button type="submit" className="practice-primary">Submit practice response</button>
            <button type="button" className="practice-secondary" onClick={() => { setResult(null); setPhase('assess'); }}>← Back to assessment</button>
          </div>
        </form>}

        {phase === 'complete' && <section className="practice-success" role="status" data-testid="scenario-complete">
          <p className="practice-success-mark" aria-hidden="true">✓</p>
          <h3>Scenario completed</h3>
          <p>Your triage, ownership, action and fictional handover met the practice rubric.</p>
          <p><strong>Why this response works:</strong> {selected.why}</p>
          <div className="practice-example"><strong>Example of a useful handover:</strong><p>{selected.example}</p></div>
          <p className="practice-disclaimer">This is a learning milestone—not an official skill certification. No real Operations record was created or approved.</p>
          <div className="practice-actions">
            <button type="button" className="practice-primary" onClick={nextScenario}>Next situation →</button>
            <button type="button" className="practice-secondary" onClick={() => switchScenario(selected.id)}>Repeat this situation</button>
          </div>
        </section>}
        <footer className="practice-footer">
          <span>Want to see the actual screens, queues and forms after this simulation?</span>
          <Link href="/">Explore the fictional Operations workspace</Link>
          {trainer && <Link href="/review">Open fictional review queue</Link>}
        </footer>
      </section>
    </div>
  </div>;
}
