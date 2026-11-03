'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { DEPARTMENT_CHANGE_EVENT, getCurrentDepartmentId } from '@/lib/session';
import {
  TASK_INSPECTION_CHANGED, readTrainingInspections, trainingInspectionKey,
} from '@/lib/training-observations';
import type { TrainingInspectionKind } from '@/lib/training-observations';

/**
 * Read-only literacy drill with authenticated backend verification.
 * Exercises use the unmodified real Tasks or Shift Handover screen, with no
 * permission elevation and no claims of independently certified performance.
 */
const DRILLS = {
  task: {
    resource: 'tasks', path: '/tasks', screen: 'Tasks',
    title: 'Find a saved task', subject: 'task',
    statuses: ['To Do', 'Doing', 'Review', 'Done'],
    values: ['Low', 'Normal', 'High', 'Urgent'],
    field: 'priority', valueLabel: 'Recorded priority',
    keyLabel: 'task-status-priority',
  },
  handover: {
    resource: 'shift-notes', path: '/shift', screen: 'Shift Handover',
    title: 'Find a handover note', subject: 'handover',
    statuses: ['New', 'Seen', 'Follow', 'Done'],
    values: ['Low', 'Normal', 'Urgent'],
    field: 'urgency', valueLabel: 'Recorded urgency',
    keyLabel: 'handover-status-urgency',
  },
  guest: {
    resource: 'guests', path: '/guests', screen: 'Guest Matters',
    title: 'Find a guest concern', subject: 'guest matter',
    statuses: ['Open', 'Follow', 'Done'],
    values: ['Low', 'Normal', 'High', 'Urgent'],
    field: 'urgency', valueLabel: 'Recorded urgency',
    keyLabel: 'guest-status-urgency',
  },
  fix: {
    resource: 'fixes', path: '/fixes', screen: 'Maintenance',
    title: 'Find a maintenance job', subject: 'maintenance work order',
    statuses: ['Open', 'Working', 'Done', 'Verified'],
    values: ['Low', 'Normal', 'High', 'Urgent'],
    field: 'urgency', valueLabel: 'Recorded urgency',
    keyLabel: 'fix-status-urgency',
  },
} as const;

function permittedTrainingRecord(record: Entity, departmentId: number, kind: TrainingInspectionKind): boolean {
  const drill = DRILLS[kind];
  return Number.isSafeInteger(Number(record.id)) && Number(record.id) > 0 &&
    Number(record.department_id) === departmentId &&
    typeof record.title === 'string' && record.title.startsWith('[TRAINING] ') &&
    drill.statuses.some(value => value === record.status) &&
    drill.values.some(value => value === record[drill.field]);
}

export function TrainingRecordLookup({
  user, kind = 'task',
}: { user: Entity; kind?: TrainingInspectionKind }) {
  const drill = DRILLS[kind];
  const prefix = {
    task: 'record-lookup',
    handover: 'handover-lookup',
    guest: 'guest-lookup',
    fix: 'fix-lookup',
  }[kind];
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [record, setRecord] = useState<Entity | null>(null);
  const [status, setStatus] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [completedAt, setCompletedAt] = useState('');

  useEffect(() => {
    let revision = 0;
    const loadForDepartment = () => {
      const current = ++revision;
      const dept = getCurrentDepartmentId(user);
      setDepartmentId(dept);
      setRecord(null);
      setStatus('');
      setValue('');
      setFeedback('');
      setCompletedAt('');
      if (!dept) return;
      const storageKey = trainingInspectionKey(user, dept, kind);
      const sessionKey = storageKey + ':record';
      try {
        const previous = readTrainingInspections(user)
          .find(row => row.departmentId === dept && row.kind === kind);
        if (previous) setCompletedAt(previous.completedAt);
        const priorId = Number(sessionStorage.getItem(sessionKey));
        if (Number.isSafeInteger(priorId) && priorId > 0) {
          void api.get(drill.resource, priorId).then(saved => {
            if (current !== revision) return;
            if (permittedTrainingRecord(saved, dept, kind)) setRecord(saved);
            else sessionStorage.removeItem(sessionKey);
          }).catch(() => {
            if (current === revision) sessionStorage.removeItem(sessionKey);
          });
        }
      } catch { /* Device storage is optional for read-only practice. */ }
    };
    loadForDepartment();
    window.addEventListener(DEPARTMENT_CHANGE_EVENT, loadForDepartment);
    return () => {
      revision += 1;
      window.removeEventListener(DEPARTMENT_CHANGE_EVENT, loadForDepartment);
    };
  }, [user, kind, drill.resource]);

  if (process.env.NEXT_PUBLIC_TRAINING_MODE !== 'true') return null;
  const selectedDepartment = Array.isArray(user.departments)
    ? user.departments.find((item: Entity) => Number(item.id) === departmentId)
    : null;
  const departmentName = String(selectedDepartment?.name || '').toLowerCase();
  const relevantDepartment = kind === 'guest'
    ? ['front desk', 'café', 'cafe'].includes(departmentName)
    : kind === 'fix' ? departmentName === 'maintenance' : true;
  if (!relevantDepartment) return null;
  const key = trainingInspectionKey(user, departmentId || 0, kind);

  async function start() {
    if (!departmentId || busy) return;
    setBusy(true);
    setFeedback('');
    try {
      const records = await api.listAll(drill.resource, { active: true, department_id: departmentId });
      if (getCurrentDepartmentId(user) !== departmentId) {
        setFeedback('You changed departments. Select the right department and start again.');
        return;
      }
      const available = records.filter(item => permittedTrainingRecord(item, departmentId, kind));
      if (!available.length) {
        setFeedback('No accessible fictional training ' + drill.subject +
          ' was found in this department. Check the department or ask your trainer.');
        return;
      }
      const next = available[Math.floor(Math.random() * available.length)];
      setRecord(next);
      setStatus('');
      setValue('');
      try { sessionStorage.setItem(key + ':record', String(next.id)); } catch { /* fine */ }
    } catch {
      setFeedback('Could not open the practice records. Check that the training app is open and you are signed in.');
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!record || !departmentId || !status || !value || busy) return;
    setBusy(true);
    setFeedback('');
    try {
      const saved = await api.get(drill.resource, record.id);
      if (getCurrentDepartmentId(user) !== departmentId) {
        setFeedback('You changed departments. Open the practice again in the correct department.');
        return;
      }
      if (!permittedTrainingRecord(saved, departmentId, kind) ||
          String(saved.title) !== String(record.title)) {
        setFeedback('This record changed or is no longer available. Start again with another record.');
        return;
      }
      if (status !== saved.status || value !== saved[drill.field]) {
        setFeedback('One or both details do not match the saved ' + drill.subject +
          '. Open it in ' + drill.screen + ' and check again.');
        return;
      }
      const now = new Date().toISOString();
      setCompletedAt(now);
      setFeedback('Correct: both answers match the actual saved fictional ' + drill.subject +
        '. You checked the saved details without changing the record.');
      try {
        localStorage.setItem(key, JSON.stringify({ completedAt: now, recordId: saved.id }));
        window.dispatchEvent(new Event(TASK_INSPECTION_CHANGED));
      } catch { /* Progress stays visible in this session. */ }
    } catch {
      setFeedback('Could not check the answer. Make sure the training app is running, then try again.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="practice-record-lookup" data-testid={'training-' + (kind === 'task' ? 'record' : kind) + '-lookup'} aria-label={'Find a practice ' + drill.subject}>
    <div>
      <p className="practice-eyebrow">PRACTICE · READ A RECORD</p>
      <h2>{drill.title}</h2>
      <p>Open {drill.screen} and find a made-up {drill.subject}. Read its details, then answer two questions here. This practice does not change the record.</p>
      {completedAt ? <p className="practice-record-result" role="status">Previously completed: {new Date(completedAt).toLocaleDateString('en-PH')}. You can repeat the exercise.</p> : null}
    </div>
    {!record ? <button type="button" className="practice-primary" onClick={() => void start()} disabled={busy || !departmentId} data-testid={prefix + '-start'}>
      {busy ? 'Finding a ' + drill.subject + '…' : 'Find a ' + drill.subject}
    </button> : <>
      <p><strong>Look for this {drill.subject}:</strong> <code data-testid={prefix + '-title'}>{String(record.title)}</code></p>
      <p>1. Open <Link href={drill.path} target="_blank" rel="noopener noreferrer">{drill.screen} in a separate tab</Link>. Find this title in your department and open it. If it is not shown, choose the All filter.</p>
      <p>2. Come back here and choose what the saved record says.</p>
      <div className="practice-record-answers">
        <label>Current {drill.subject} status
          <select data-testid={prefix + '-status'} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="">Choose status…</option>
            {drill.statuses.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>{drill.valueLabel}
          <select data-testid={prefix + '-priority'} value={value} onChange={event => setValue(event.target.value)}>
            <option value="">Choose {drill.valueLabel.toLowerCase()}…</option>
            {drill.values.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>
      <div className="practice-actions">
        <button type="button" className="practice-primary" data-testid={prefix + '-check'} disabled={!status || !value || busy} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check my answers'}
        </button>
        <button type="button" className="practice-secondary" disabled={busy} onClick={() => void start()}>Try another {drill.subject}</button>
      </div>
    </>}
    {feedback ? <p className="practice-record-result" data-testid={prefix + '-feedback'} role="status">{feedback}</p> : null}
    <small>This practice checks whether your answers match. It does not change any records or give permission to use the live system.</small>
  </section>;
}
