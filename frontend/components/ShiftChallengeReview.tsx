'use client';
import { useEffect,useState } from 'react';
import { api,Entity } from '@/lib/api';
import { getStoredUser } from '@/lib/session';
import { hasCapability } from '@/lib/capabilities';

export function ShiftChallengeReview() {
  const [user,setUser]=useState<Entity|null>(null),[department,setDepartment]=useState('');
  const [jobs,setJobs]=useState<Entity[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const u=getStoredUser();setUser(u);setDepartment(String(u?.primary_department_id||u?.departments?.[0]?.id||''));},[]);
  useEffect(()=>{
    if(!department||!hasCapability(user,'manage_department')||process.env.NEXT_PUBLIC_TRAINING_MODE!=='true')return;
    let current=true;setBusy(true);setError('');setJobs([]);
    void api.listAll('tasks',{active:true,department_id:department}).then(rows=>Promise.all(rows.filter(t=>/^\[TRAINING\] SHIFT-(FD|HK|CAFE|KT|MT|MK|SC)-01 — /.test(t.title||'')).map(t=>api.get('tasks',Number(t.id))))).then(rows=>{if(current)setJobs(rows);}).catch(()=>{if(current)setError('Could not open the saved shift follow-ups. Check that the training app is running and try again.');}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[department,user]);
  if(process.env.NEXT_PUBLIC_TRAINING_MODE!=='true')return null;
  if(!hasCapability(user,'manage_department'))return <p>Shift follow-ups are reviewed by your lead or trainer.</p>;
  return <section className="shift-challenge" aria-label="Review saved shift follow-ups">
    <p className="practice-eyebrow">FOR LEADS AND TRAINERS</p><h1>Review shift follow-ups</h1>
    <p>Read the notes employees saved on their assigned training jobs. Ask them to explain the next action and who will check it.</p>
    <label className="label">Department<select className="select" value={department} onChange={e=>setDepartment(e.target.value)}>{(user?.departments||[]).map((d:Entity)=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    {busy&&<p role="status">Opening saved follow-ups…</p>}{error&&<p role="alert">{error}</p>}
    {!busy&&!error&&!jobs.length&&<p>No shift challenge is assigned in this department. Choose a staff department to review its practice.</p>}
    {jobs.map(job=><article className="shift-challenge-brief" key={job.id}><h2>{job.title}</h2><p><strong>Assigned to:</strong> {job.assigned_to_name||'A staff member in this department'}</p><p>{job.note}</p>
      {(job.comments||[]).filter((c:Entity)=>c.comment_type==='Shift follow-up'&&Number(c.author_id)===Number(job.assigned_to_id)).map((comment:Entity)=><section key={comment.id}><h3>Saved employee follow-up</h3><p className="shift-challenge-note">{comment.body}</p><small>Saved {new Date(comment.created_at).toLocaleString('en-PH')}</small></section>)}
      {!(job.comments||[]).some((c:Entity)=>c.comment_type==='Shift follow-up'&&Number(c.author_id)===Number(job.assigned_to_id))&&<p>No follow-up has been saved yet.</p>}
    </article>)}
    <p>These are practice notes. This screen does not approve work or certify an employee.</p>
  </section>;
}
