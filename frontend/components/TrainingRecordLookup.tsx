'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId } from '@/lib/session';
import { TASK_INSPECTION_CHANGED, taskInspectionKey } from '@/lib/training-observations';

/**
 * Read-only operational-record literacy drill. All staff, including those
 * without manage_department, may inspect permitted fictional task records.
 * This NEVER grants a mutation capability or certifies task completion.
 */
const STATUSES = ['To Do', 'Doing', 'Review', 'Done'] as const;
const PRIORITIES = ['Normal', 'High', 'Urgent'] as const;
const ACTIVE_PREFIX = '[TRAINING] ';

function validPracticeTask(task: Entity, departmentId: number): boolean {
  return Number.isSafeInteger(Number(task.id)) && Number(task.id) > 0 &&
    Number(task.department_id) === departmentId &&
    typeof task.title === 'string' && task.title.startsWith(ACTIVE_PREFIX) &&
    STATUSES.some(status => status === task.status) &&
    PRIORITIES.some(priority => priority === task.priority);
}

export function TrainingRecordLookup({ user }: { user: Entity }) {
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [task, setTask] = useState<Entity | null>(null);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [completedAt, setCompletedAt] = useState('');

  useEffect(() => {
    const dept = getCurrentDepartmentId(user);
    setDepartmentId(dept);
    if (!dept) return;
    const storageKey = taskInspectionKey(user, dept);
    const sessionKey = storageKey + ':task';
    try {
      const previous = localStorage.getItem(storageKey);
      if (previous) {
        const decoded = JSON.parse(previous);
        if (decoded && typeof decoded.completedAt === 'string') setCompletedAt(decoded.completedAt);
      }
      const priorId = Number(sessionStorage.getItem(sessionKey));
      if (Number.isSafeInteger(priorId) && priorId > 0) {
        // The local storage identifier is only a bookmark, never evidence.
        void api.get('tasks', priorId).then(saved => {
          if (validPracticeTask(saved, dept)) setTask(saved);
          else sessionStorage.removeItem(sessionKey);
        }).catch(() => sessionStorage.removeItem(sessionKey));
      }
    } catch { /* Device storage is optional for reading the task. */ }
  }, [user]);

  if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return null;

  const key = taskInspectionKey(user, departmentId || 0);

  async function start() {
    if (!departmentId || busy) return;
    setBusy(true);
    setFeedback('');
    try {
      const records = await api.listAll('tasks', { active: true, department_id: departmentId });
      const available = records.filter(record => validPracticeTask(record, departmentId));
      if (!available.length) {
        setFeedback('No accessible fictional training task was found for this department. Confirm the selected workspace or ask the trainer.');
        return;
      }
      const next = available[Math.floor(Math.random() * available.length)];
      setTask(next);
      setStatus('');
      setPriority('');
      try { sessionStorage.setItem(key + ':task', String(next.id)); } catch { /* fine */ }
    } catch {
      setFeedback('Could not read local training tasks. Open the training app again and confirm you are signed in.');
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!task || !departmentId || !status || !priority || busy) return;
    setBusy(true);
    setFeedback('');
    try {
      // Compare against an authenticated, current backend read, not the cached
      // task or a local quiz answer key.
      const saved = await api.get('tasks', task.id);
      if (!validPracticeTask(saved, departmentId) || String(saved.title) !== String(task.title)) {
        setFeedback('This task is no longer accessible or its details changed. Start a new investigation.');
        return;
      }
      if (status !== saved.status || priority !== saved.priority) {
        setFeedback('One or both details do not match the saved task. Reopen its card in Tasks and check its status and priority.');
        return;
      }
      const now = new Date().toISOString();
      setCompletedAt(now);
      setFeedback('Correct: both answers match the actual saved fictional task. You inspected operational data without changing it.');
      try {
        localStorage.setItem(key, JSON.stringify({ completedAt: now, taskId: saved.id }));
        window.dispatchEvent(new Event(TASK_INSPECTION_CHANGED));
      } catch { /* progress stays visible in session */ }
    } catch {
      setFeedback('Verification could not reach the local training database. Retry after confirming the service is running.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="practice-record-lookup" data-testid="training-record-lookup" aria-label="Read-only task investigation">
    <div>
      <p className="practice-eyebrow">STAFF-SAFE PRACTICAL EXERCISE</p>
      <h2>Find and inspect a saved task</h2>
      <p>Use the actual Operations Tasks screen to investigate one fictional work item. All roles can practise reading records; only authorized roles can edit them.</p>
      {completedAt ? <p className="practice-record-result" role="status">Previously completed: {new Date(completedAt).toLocaleDateString('en-PH')}. You can repeat the exercise.</p> : null}
    </div>
    {!task ? <button type="button" className="practice-primary" onClick={() => void start()} disabled={busy || !departmentId} data-testid="record-lookup-start">
      {busy ? 'Finding a task…' : 'Start task investigation'}
    </button> : <>
      <p><strong>Find this exact fictional task:</strong> <code data-testid="record-lookup-title">{String(task.title)}</code></p>
      <p>1. Open <Link href="/tasks" target="_blank" rel="noopener noreferrer">Tasks in a separate tab</Link> and find this title in the same department. Open its card and read the saved details.</p>
      <p>2. Return here. Choose what the actual record says; do not change the task or guess based on its title.</p>
      <div className="practice-record-answers">
        <label>Current task status
          <select data-testid="record-lookup-status" value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Choose status…</option>
            {STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Recorded priority
          <select data-testid="record-lookup-priority" value={priority} onChange={event => setPriority(event.target.value)}>
            <option value="">Choose priority…</option>
            {PRIORITIES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="practice-actions">
        <button type="button" className="practice-primary" data-testid="record-lookup-check" disabled={!status || !priority || busy} onClick={() => void check()}>
          {busy ? 'Checking saved task…' : 'Check against saved task'}
        </button>
        <button type="button" className="practice-secondary" disabled={busy} onClick={() => void start()}>Try another task</button>
      </div>
    </>}
    {feedback ? <p className="practice-record-result" data-testid="record-lookup-feedback" role="status">{feedback}</p> : null}
    <small>This is a read-only skills drill, not proof that work was completed or a signed staff certification. All records are fictional and remain on this device.</small>
  </section>;
}
