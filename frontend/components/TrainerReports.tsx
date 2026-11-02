'use client';

import { useEffect, useState } from 'react';
import type { Entity } from '@/lib/api';
import { parseTrainingReport } from '@/lib/training-progress-report';
import type { TrainingProgressReport } from '@/lib/training-progress-report';

type Reviewed = { report: TrainingProgressReport; supervisorNote: string; reviewedAt?: string };
const PREFIX = 'ho-ops-local-trainer-reports-v1:';

/** Offline-only review of intentionally exported training reports.
 * Cannot grant Operations permissions or issue a verified qualification.
 */
export function TrainerReports({manager}: {manager: Entity}) {
  const key = PREFIX + String(manager.id || manager.email || '');
  const [records, setRecords] = useState<Reviewed[]>([]);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [active, setActive] = useState(false);

  useEffect(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(raw)) return;
      const valid = raw.slice(0,40).flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const v = entry as Record<string,unknown>;
        const report = parseTrainingReport(v.report);
        if (!report) return [];
        return [{report, supervisorNote:typeof v.supervisorNote==='string'?v.supervisorNote.slice(0,600):'',
          reviewedAt:typeof v.reviewedAt==='string'?v.reviewedAt.slice(0,40):undefined}];
      });
      setRecords(valid);
    } catch { setMessage('Could not read earlier reports on this computer. You can import a report again.'); }
  }, [key]);

  function save(next: Reviewed[]) {
    try {
      localStorage.setItem(key,JSON.stringify(next.slice(0,40)));
      setRecords(next.slice(0,40));
    } catch { setMessage('Not enough local storage to keep this trainer review. Export a copy and free up device storage.'); }
  }

  async function importReports(file: File | undefined) {
    if (!file) return;
    if (file.size > 120000) { setMessage('Report too large. Export a training progress report from the trainee app.'); return; }
    try {
      const data: unknown = JSON.parse(await file.text());
      const report = parseTrainingReport(data);
      if (!report) { setMessage('This is not a valid Hidden Oasis training progress report. No data was imported.'); return; }
      save([{report,supervisorNote:'Review imported: confirm the trainee practised on a real device before signing anything.',
        },...records.filter(item => item.report.trainee.id !== report.trainee.id)]);
      setMessage('Report imported for ' + report.trainee.name + '. Check the practical results; the file is not proof of skill on its own.');
    } catch { setMessage('Could not read this file. Ask the trainee to export a new report.'); }
  }

  function markReviewed(report: TrainingProgressReport) {
    const note = (notes[report.trainee.id] || '').trim();
    if (note.length < 12) { setMessage('Write at least a short observation before recording a review.'); return; }
    save(records.map(item=>item.report.trainee.id===report.trainee.id
      ? {...item,supervisorNote:note.slice(0,600),reviewedAt:new Date().toISOString()} : item));
    setMessage('Your review note was saved on this computer only. This is not an HR certification or live employee record.');
  }

  return <section className="ops-trainer-dashboard" data-testid="trainer-progress-dashboard">
    <button type="button" className="ops-trainer-toggle" aria-expanded={active}
      onClick={() => setActive(value=>!value)}>
      <strong>Supervisor training review</strong>
      <span>{records.length} imported trainee report{records.length===1?'':'s'} · {active?'Hide':'Open'} →</span>
    </button>
    {active && <>
      <p>Ask each staff member to save their training report, then open it here. You can see finished lessons and add a note. Reports stay on this computer and do not change anyone&apos;s access.</p>
      <label className="ops-trainer-import">Open a staff training report
        <input type="file" accept=".json,application/json" onChange={event => {
          void importReports(event.target.files?.[0]); event.target.value='';
        }} />
      </label>
      {message && <p role="status" className="ops-trainer-message">{message}</p>}
      {!records.length && <p>No reports added yet. Ask the staff member to choose Save my training report and give you the saved JSON file.</p>}
      {records.map(item=><article key={item.report.trainee.id} className="ops-trainer-record">
        <h3>{item.report.trainee.name} <small>({item.report.trainee.role})</small></h3>
        <p><strong>{item.report.completedLessons.length} lessons reported complete</strong> · Latest: {item.report.currentLesson} ({item.report.currentStage})</p>
        <p>Quiz corrections: {Object.values(item.report.metrics).reduce((sum,m)=>sum+(m.incorrectAnswers||0),0)}
          {' · '}Lesson repeats: {Object.values(item.report.metrics).reduce((sum,m)=>sum+(m.repeats||0),0)}
          {' · '}Practice records reported: {item.report.verifiedPractice.length}</p>
        <details><summary>See lessons and practice</summary>
          <p>Completed: {item.report.completedLessons.join(', ')||'None'}</p>
          {item.report.verifiedPractice.map(work=><p key={work.reference}>{work.kind}: {work.reference} ({work.stages} stages reported)</p>)}
        </details>
        <p><strong>Review note:</strong> {item.supervisorNote}</p>
        {item.reviewedAt && <small>Reviewed locally: {item.reviewedAt}</small>}
        <label>Trainer&apos;s notes or practice needed
          <textarea rows={2} maxLength={600} value={notes[item.report.trainee.id] || ''}
            onChange={event=>setNotes(current=>({...current,[item.report.trainee.id]:event.target.value}))}
            placeholder="Example: Staff member wrote a clear handover note. Please practise maintenance urgency again." />
        </label>
        <button type="button" className="ops-trainer-save" onClick={()=>markReviewed(item.report)}>Save review note locally</button>
      </article>)}
      <p><strong>Please note:</strong> Training reports can be edited. Watch the staff member complete important tasks yourself. This review does not give permission to use live records or approve purchases.</p>
    </>}
  </section>;
}
