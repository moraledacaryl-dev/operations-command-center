'use client';

import { useEffect, useState } from 'react';
import type { Entity } from '@/lib/api';
import { parseTrainingReport } from '@/lib/training-progress-report';
import type { TrainingProgressReport } from '@/lib/training-progress-report';
import { TRAINING_LESSONS } from '@/lib/interactive-training';

type Reviewed = { id: string; staffName: string; report: TrainingProgressReport; supervisorNote: string; reviewedAt?: string };
const PREFIX = 'ho-ops-local-trainer-reports-v1:';
const lessonTitle = (id: string) => TRAINING_LESSONS.find(lesson => lesson.id === id)?.title || id;
const practiceTitle: Record<string,string> = { 'bar-report': 'Bar report', 'guest-ac': 'Guest concern', 'shared-no-owner': 'Assign a task', 'shift-unresolved': 'Shift handover', 'mt-light-fault': 'Maintenance report', 'manager-evidence': 'Work request', 'fd-broken-shower': 'Guest and maintenance follow-up' };
const stageTitle: Record<string,string> = { learn:'Reading', quiz:'Answering questions', tour:'Guided practice', work:'Practising', independent:'Trying without arrows', done:'Lesson finished', finished:'Lessons finished' };

/** Reports are imported by a supervisor and remain on this device. Practice
 * logins are fictional and may be reused; they are not employee identifiers. */
export function TrainerReports({manager}: {manager: Entity}) {
  const key = PREFIX + String(manager.id || manager.email || '');
  const [records, setRecords] = useState<Reviewed[]>([]);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [staffName, setStaffName] = useState('');
  const [active, setActive] = useState(false);

  useEffect(() => {
    function load() {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(raw)) return;
      const valid = raw.slice(0,40).flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object') return [];
        const v = entry as Record<string,unknown>;
        const report = parseTrainingReport(v.report);
        if (!report) return [];
        return [{ id:typeof v.id === 'string' && v.id ? v.id.slice(0,100) : `earlier-${index}-${report.trainee.id}`,
          staffName:typeof v.staffName === 'string' ? v.staffName.slice(0,100) : '', report,
          supervisorNote:typeof v.supervisorNote==='string'?v.supervisorNote.slice(0,600):'',
          reviewedAt:typeof v.reviewedAt==='string'?v.reviewedAt.slice(0,40):undefined }];
      });
      setRecords(valid);
    } catch { setMessage('Could not read earlier reports on this computer. You can open a report again.'); }
    }
    load();
    window.addEventListener('training-reviews-changed', load);
    window.addEventListener('storage', load);
    return () => { window.removeEventListener('training-reviews-changed', load); window.removeEventListener('storage', load); };
  }, [key]);

  function save(next: Reviewed[]) {
    try {
      localStorage.setItem(key,JSON.stringify(next.slice(0,40)));
      setRecords(next.slice(0,40));
      window.dispatchEvent(new Event('training-reviews-changed'));
      return true;
    } catch { setMessage('This computer could not save the review. Free up storage and try again.'); return false; }
  }

  async function importReports(file: File | undefined) {
    if (!file) return;
    const name = staffName.trim();
    if (!name) { setMessage('Enter the staff member’s name before opening their report.'); return; }
    if (records.length >= 40) { setMessage('This computer has 40 reports. Keep the report files, then remove an older review before adding another.'); return; }
    if (file.size > 120000) { setMessage('This file is too large. Ask the staff member for their training report.'); return; }
    try {
      const data: unknown = JSON.parse(await file.text());
      const report = parseTrainingReport(data);
      if (!report) { setMessage('This is not a valid training report. No data was added.'); return; }
      if (records.some(item => item.staffName.toLocaleLowerCase() === name.toLocaleLowerCase() && JSON.stringify(item.report) === JSON.stringify(report))) {
        setMessage('This report is already listed for ' + name + '.'); return;
      }
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (save([{id,staffName:name,report,supervisorNote:''},...records])) {
        setStaffName(''); setMessage('Report added for ' + name + '. Check their practice and add a note.');
      }
    } catch { setMessage('Could not read this file. Ask the staff member to save a new report.'); }
  }

  function markReviewed(id: string) {
    const note = (notes[id] || '').trim();
    if (note.length < 12) { setMessage('Write a short observation before saving the review.'); return; }
    if (save(records.map(item=>item.id===id ? {...item,supervisorNote:note.slice(0,600),reviewedAt:new Date().toISOString()} : item)))
      setMessage('Your review note was saved on this computer only.');
  }

  return <section className="ops-trainer-dashboard" data-testid="trainer-progress-dashboard">
    <button type="button" className="ops-trainer-toggle" aria-expanded={active} onClick={() => setActive(value=>!value)}>
      <strong>Staff training results</strong>
      <span>{records.length} report{records.length===1?'':'s'} · {active?'Hide':'Open'} →</span>
    </button>
    {active && <>
      <p>Ask each staff member to save their training report and give you the file. Enter their name, then open their report here. Results stay on this computer.</p>
      <p>Training logins are shared practice identities. Check whose file it is; the practice name is not the staff member&apos;s name.</p>
      <label className="ops-trainer-import">Staff member&apos;s name
        <input type="text" maxLength={100} value={staffName} onChange={event=>setStaffName(event.target.value)} placeholder="Example: Ann Clarin" />
      </label>
      <label className="ops-trainer-import">Open their training report
        <input type="file" accept=".json,application/json" onChange={event => {
          void importReports(event.target.files?.[0]); event.target.value='';
        }} />
      </label>
      {message && <p role="status" className="ops-trainer-message">{message}</p>}
      {!records.length && <p>No reports added yet. Ask the staff member to choose Save my training report and give you the file.</p>}
      {records.map(item=><article key={item.id} className="ops-trainer-record">
        <h3>{item.staffName || 'Name not recorded'} <small>Practice login: {item.report.trainee.name}</small></h3>
        {!item.staffName && <p>This earlier report does not have a staff name. Confirm whose report it is before relying on it.</p>}
        <p><strong>{item.report.completedLessons.length} lessons reported complete</strong> · Latest: {lessonTitle(item.report.currentLesson)} ({stageTitle[item.report.currentStage] || 'In progress'})</p>
        <p>Quiz corrections: {Object.values(item.report.metrics).reduce((sum,m)=>sum+(m.incorrectAnswers||0),0)}
          {' · '}Lesson repeats: {Object.values(item.report.metrics).reduce((sum,m)=>sum+(m.repeats||0),0)}
          {' · '}Practice records reported: {item.report.verifiedPractice.length}</p>
        <details><summary>See lessons and practice</summary>
          <p>Completed: {item.report.completedLessons.map(lessonTitle).join(', ')||'None'}</p>
          {item.report.verifiedPractice.map(work=><p key={work.reference}>{practiceTitle[work.kind] || 'Practice'}: {work.reference} ({work.stages} steps reported)</p>)}
        </details>
        {item.supervisorNote && <p><strong>Review note:</strong> {item.supervisorNote}</p>}
        {item.reviewedAt && <small>Reviewed on this computer: {item.reviewedAt}</small>}
        <label>Trainer&apos;s notes or practice needed
          <textarea rows={2} maxLength={600} value={notes[item.id] || ''}
            onChange={event=>setNotes(current=>({...current,[item.id]:event.target.value}))}
            placeholder="Example: Please practise the handover again." />
        </label>
        <button type="button" className="ops-trainer-save" onClick={()=>markReviewed(item.id)}>Save review note locally</button>
        <button type="button" className="ops-trainer-save" onClick={() => {
          if (window.confirm('Remove this review from this computer? Keep the original report file if you may need it again.')) save(records.filter(record => record.id !== item.id));
        }}>Remove local review</button>
      </article>)}
      <p>Reports can be edited. Watch important tasks in person before deciding whether someone is ready.</p>
    </>}
  </section>;
}
