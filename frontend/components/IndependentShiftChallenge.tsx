'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { hasCapability } from '@/lib/capabilities';
import {
  assessShiftNote, emptyShiftAnswers, readShiftAttempt, savedShiftBody, shiftCaseFor,
  shiftChallengeKey, shiftHandoverTitle, shiftRecords, shiftTaskTitle,
  SHIFT_CHALLENGE_EVENT, SHIFT_CHALLENGE_PATH, verifyShiftEvidence,
} from '@/lib/training-shift-challenge';
import type { ShiftAnswers, ShiftAttempt } from '@/lib/training-shift-challenge';

/** Training-only challenge. Operational pages and permissions stay unchanged. */
export function IndependentShiftChallenge({user,path}:{user:Entity;path:string}) {
  const c=shiftCaseFor(user);
  const [attempt,setAttempt]=useState<ShiftAttempt|null>(null);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [checks,setChecks]=useState<string[]>([]);
  const [help,setHelp]=useState(false);
  const [storageError,setStorageError]=useState(false);
  const current=useRef(attempt); current.current=attempt;
  const heading=useRef<HTMLHeadingElement>(null);
  const key=shiftChallengeKey(user);
  const isPage=path===SHIFT_CHALLENGE_PATH;
  const observing=Boolean(attempt&&!attempt.completedAt);
  const save=useCallback((value:ShiftAttempt)=>{
    current.current=value;setAttempt(value);
    try {localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event(SHIFT_CHALLENGE_EVENT));}
    catch {setStorageError(true);}
  },[key]);
  useEffect(()=>{
    setReady(false);setMessage('');setChecks([]);setErrors({});
    try {setAttempt(c?readShiftAttempt(localStorage.getItem(key),c):null);} catch {setStorageError(true);}
    setReady(true);
  },[key,c]);

  useEffect(()=>{
    if(!c || !observing) return;
    // Observe the actual opened detail dialog, including My Work's read-only drawer.
    // Reading a list title, pressing a Next button or guessing an ID is insufficient.
    const inspect=()=>{
      const a=current.current;if(!a)return;
      const titles=Array.from(document.querySelectorAll('[role="dialog"] h1')).filter(el=>el.getClientRects().length>0).map(el=>el.textContent?.trim());
      const task=(path==='/my-work' || path==='/tasks')&&titles.includes(shiftTaskTitle(c));
      const handover=path==='/shift'&&titles.includes(shiftHandoverTitle(c));
      if((task&&!a.openedTask)||(handover&&!a.openedHandover))save({...a,openedTask:a.openedTask||task,openedHandover:a.openedHandover||handover});
    };
    const observer=new MutationObserver(inspect);observer.observe(document.body,{childList:true,subtree:true});inspect();
    return()=>observer.disconnect();
  },[c,path,observing,save]);
  if(process.env.NEXT_PUBLIC_TRAINING_MODE!=='true'||!ready)return null;
  if(!c)return path==='/training'&&hasCapability(user,'manage_department')?<section className="shift-challenge-entry"><div><h2>Staff shift challenges</h2><p>Read the follow-ups employees saved on their training jobs.</p></div><Link className="btn" href="/training/shift-review">Review shift follow-ups</Link></section>:null;

  async function start() {
    if(!c || busy)return;setBusy(true);setMessage('');
    try {
      const r=await shiftRecords(user,c);
      save({reference:c.reference,taskId:Number(r.task.id),handoverId:Number(r.handover.id),noticeId:Number(r.notice.id),startedAt:new Date().toISOString(),openedTask:false,openedHandover:false,answers:emptyShiftAnswers()});
    }catch(err){setMessage(err instanceof Error?err.message:'Could not open your challenge. Try again.');}
    finally{setBusy(false);}
  }
  function answer(field:keyof ShiftAnswers,value:string) {
    if(!attempt)return;
    save({...attempt,answers:{...attempt.answers,[field]:value},completedAt:undefined});
    setErrors(old=>({...old,[field]:''}));setChecks([]);setMessage('');
  }
  function showErrors(problems:Record<string,string>) {
    setErrors(problems);
    const first=['status','priority','team','decision','owner','followUp','note'].find(field=>problems[field]);
    if(first)requestAnimationFrame(()=>{const field=document.getElementById('shift-field-'+first);field?.focus({preventScroll:true});field?.scrollIntoView({block:'center',behavior:'instant'});});
  }
  async function saveNote() {
    if(!c || !attempt || busy)return;
    const problems=assessShiftNote(c,attempt.answers);showErrors(problems);setChecks([]);
    if(Object.keys(problems).length){setMessage('Check the marked answers before saving your follow-up.');return;}
    if(!attempt.openedHandover||!attempt.openedTask){setMessage('Read the named handover and your assigned job first. Use the app menu, then return here.');return;}
    setBusy(true);setMessage('');
    try {
      const r=await shiftRecords(user,c,attempt);
      if(attempt.answers.status!==r.handover.status){showErrors({status:'This does not match the saved handover. Open it and check again.'});return;}
      const body=savedShiftBody(c,attempt.answers);
      const prior=r.task.comments?.find((x:Entity)=>Number(x.author_id)===Number(user.id)&&x.body===body&&x.comment_type==='Shift follow-up'&&Date.parse(x.created_at)>=Date.parse(attempt.startedAt)-1000);
      const comment=prior||await api.comment('tasks',attempt.taskId,body,'Shift follow-up');
      // Read it back. A successful click alone is not saved-work evidence.
      const saved=await api.get('tasks',attempt.taskId);
      if(!saved.comments?.some((x:Entity)=>Number(x.id)===Number(comment.id)&&Number(x.author_id)===Number(user.id)&&x.body===body))throw new Error('Your note could not be checked after saving. Try Check shift challenge before saving again.');
      save({...attempt,commentId:Number(comment.id)});setMessage('Your follow-up is saved on your assigned job. Choose Check shift challenge when you are ready.');
    }catch(err){setMessage(err instanceof Error?err.message:'Could not save your follow-up. Your draft is still here.');}
    finally{setBusy(false);}
  }
  async function check() {
    if(!c||!attempt||busy)return;setBusy(true);setMessage('');
    try {
      const problems=assessShiftNote(c,attempt.answers);showErrors(problems);
      const records=await shiftRecords(user,c,attempt);
      const missing=verifyShiftEvidence(user,c,attempt,records);setChecks(missing);
      if(!Object.keys(problems).length&&!missing.length){save({...attempt,completedAt:new Date().toISOString()});setMessage('Checked against your saved job, follow-up and notice.');heading.current?.focus();}
    }catch(err){setMessage(err instanceof Error?err.message:'Could not check your shift. Your draft is still here.');}
    finally{setBusy(false);}
  }
  if(!isPage) {
    if(path==='/training')return <section className="shift-challenge-entry" aria-label="Independent shift challenge">
      <div><p className="practice-eyebrow">AFTER YOUR LESSONS</p><h2>Try a shift on your own</h2><p>Read unfinished work, check your job, and leave a useful follow-up.</p></div>
      <Link className="btn" href={SHIFT_CHALLENGE_PATH}>{attempt?.completedAt?'View your shift result':attempt?'Continue shift challenge':'Open your shift challenge'}</Link>
    </section>;
    if(!attempt||attempt.completedAt)return null;
    return <aside className="shift-challenge-return" aria-label="Your shift challenge"><span><strong>Shift challenge</strong> · {c.reference}</span><Link href={SHIFT_CHALLENGE_PATH}>Return to your challenge</Link></aside>;
  }
  return <section className="shift-challenge" aria-label="Independent shift challenge" data-testid="independent-shift-challenge">
    <p className="practice-eyebrow">{c.department.toUpperCase()} · YOUR TURN</p>
    <h1 ref={heading} tabIndex={-1}>{attempt?.completedAt?'Shift challenge completed':'Handle the unfinished work'}</h1>
    {attempt?.completedAt?<>
      <p>You read the handover and job, marked your notice read, and saved a follow-up under your own login.</p>
      <p className="shift-challenge-success" role="status">Completed {new Date(attempt.completedAt).toLocaleDateString('en-PH')}. Your saved records were checked.</p>
      <h2>Your follow-up</h2><p className="shift-challenge-note">{attempt.answers.note}</p><p><strong>Responsible:</strong> {attempt.answers.owner}</p><p><strong>Next check:</strong> {attempt.answers.followUp}</p>
      <p>A trainer still needs to observe your work before you use the live system.</p>
      <div className="toolbar"><Link className="btn" href="/training">Back to training</Link><button className="btn secondary" disabled={busy} onClick={()=>void check()}>Check saved records again</button><button className="btn secondary" disabled={busy} onClick={()=>void start()}>Try this shift again</button></div><small>Repeating starts a new attempt. Your saved job notes and other lessons stay.</small>
    </>:<>
      <p>Use what you learned to handle one shift problem. There are no arrows. You can open help if you need it.</p>
      <div className="shift-challenge-brief"><h2>{c.title}</h2><p>{c.situation}</p><span className="muted">Practice number: {c.reference} · All details are made up.</span></div>
      {!attempt?<><p>Read the handover and your assigned job in the app. Check your shift notice, then come back here to leave a follow-up.</p><button className="btn" disabled={busy} onClick={()=>void start()}>{busy?'Opening…':'Start shift challenge'}</button></>:<>
        <ol className="shift-challenge-tasks">
          <li><strong>Read the unfinished work.</strong><span>In Shift Handover, read the note with practice number {c.reference}. Then read your job with the same number in My Work.</span></li>
          <li><strong>Check your notice.</strong><span>In Notifications, read the shift notice with this number. Choose Mark read if it is unread.</span></li>
          <li><strong>Leave a follow-up.</strong><span>Return here. Say what still needs doing, who should handle it and what to check next. Save your note on your assigned job.</span></li>
        </ol>
        <details className="shift-challenge-help" onToggle={e=>setHelp(e.currentTarget.open)}><summary>Need help finding the screens?</summary><p>In the app menu, Shift Handover is under Property. Notifications is under Activity; you can also use the bell. On a phone, open More first. Close record details before returning here.</p><div className="toolbar"><Link href="/shift">Open Shift Handover</Link><Link href="/my-work">Open My Work</Link><Link href="/notifications">Open Notifications</Link></div><p>{c.help}</p></details>
        <p>Use the form below for this practice. In the live app, My Work does not have this form. Tell your lead the update so they can record it in Shift Handover.</p>
        <form onSubmit={e=>{e.preventDefault();void saveNote();}} className="shift-challenge-form">
          <h2>Your shift follow-up</h2><p>Use made-up details. Describe actions still needed; do not claim an unconfirmed job is finished.</p>
          <div className="shift-challenge-fields">
            {([
              ['status','What status is saved on the handover?',['New','Seen','Follow','Done']],
              ['priority','How soon should staff act?',['Routine','High','Critical']],
              ['team',c.department === 'Café' ? 'Which team should follow up with the guest?' : 'Which team should handle the problem?',['Front Desk','Housekeeping','Café','Kitchen','Maintenance','Marketing','Security']],
              ['decision','What should happen next?',['Document and monitor','Assign and follow up','Escalate immediately','Return for changes']],
            ] as [keyof ShiftAnswers,string,string[]][]).map(([field,label,options])=><label key={field} htmlFor={'shift-field-'+field}>{label}<select id={'shift-field-'+field} aria-label={label} value={attempt.answers[field]} onChange={e=>answer(field,e.target.value)} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field]?'shift-error-'+field:undefined}><option value="">Choose…</option>{options.map(v=><option key={v} value={v}>{({Routine:'Routine — planned work',High:'High — help soon',Critical:'Critical — get help now','Escalate immediately':'Get the lead’s help now','Assign and follow up':'Ask the right team and follow up','Return for changes':'Ask for a correction','Document and monitor':'Write it down and keep checking'} as Record<string,string>)[v]||v}</option>)}</select>{errors[field]&&<span id={'shift-error-'+field} className="shift-challenge-error">{errors[field]}</span>}</label>)}
          </div>
          {([['owner','Who should take responsibility?','Use a role, such as the on-duty lead.'],['followUp','What will be checked next, and when?','Name who will check and when they should report back.'],['note','Your note for the next shift','Include the practice number, the unfinished problem and the next action.']] as const).map(([field,label,hint])=><label key={field} htmlFor={'shift-field-'+field}>{label}<textarea id={'shift-field-'+field} aria-label={label} rows={field==='note'?5:2} maxLength={4000} value={attempt.answers[field]} onChange={e=>answer(field,e.target.value)} aria-invalid={Boolean(errors[field])} aria-describedby={'shift-hint-'+field+(errors[field]?' shift-error-'+field:'')}/><span id={'shift-hint-'+field} className="muted">{hint}</span>{errors[field]&&<span id={'shift-error-'+field} className="shift-challenge-error">{errors[field]}</span>}</label>)}
          <div className="toolbar"><button className="btn" type="submit" disabled={busy}>{busy?'Checking…':'Save follow-up on my job'}</button><button className="btn secondary" type="button" disabled={busy} onClick={()=>void check()}>Check shift challenge</button></div>
          <small>Your note is saved as a comment on your assigned training job. It does not change the job&apos;s status.</small>
        </form>
      </>}
    </>}
    {attempt&&!attempt.completedAt&&<details className="shift-challenge-help"><summary>Need to start over?</summary><p>This clears this attempt’s answers. Your other lessons and saved job comments stay.</p><button className="btn secondary" disabled={busy} onClick={()=>void start()}>Start a new attempt</button></details>}
    {message&&<p role="status" className="shift-challenge-feedback">{message}</p>}
    {checks.length>0&&<div role="status" className="shift-challenge-feedback"><strong>Still to do</strong><ul>{checks.map(s=><li key={s}>{s}</li>)}</ul></div>}
    {storageError&&<p role="alert">This browser could not save your challenge progress. Keep this page open and ask your trainer for help.</p>}
    {help&&<span className="sr-only">Help is open. No arrows are shown.</span>}
  </section>;
}
