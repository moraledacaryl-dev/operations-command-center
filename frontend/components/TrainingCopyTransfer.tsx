'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {api,ApiError} from '@/lib/api';
import {trainingCopyStorage} from '@/lib/training-copy';

export function TrainingCopyTransfer() {
  const [available,setAvailable]=useState(false);
  const [busy,setBusy]=useState(false);
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [openPassword,setOpenPassword]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [message,setMessage]=useState('');
  const [pending,setPending]=useState(false);
  useEffect(()=>{let active=true;api.trainingProfile().then(()=>{if(active)setAvailable(true);}).catch(()=>{});return()=>{active=false;};},[]);
  async function save(event:FormEvent) {
    event.preventDefault();if(busy)return;
    if(password!==confirmation){setMessage('The passwords do not match.');return;}
    setBusy(true);setMessage('');
    try {
      const blob=await api.exportTrainingCopy(password,trainingCopyStorage(localStorage));
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='Operations-Training.hotraining';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setPassword('');setConfirmation('');setMessage('Training copy saved. Keep its password separately.');
    }catch(error){setMessage(error instanceof ApiError?error.message:'Could not save the training copy. Please try again.');}finally{setBusy(false);}
  }
  async function open(event:FormEvent) {
    event.preventDefault();if(busy||!file)return;
    setBusy(true);setMessage('');
    try {
      const form=new FormData();form.append('file',file);form.append('password',openPassword);form.append('previous_learning',JSON.stringify(trainingCopyStorage(localStorage)));
      const result=await api.importTrainingCopy(form);setPending(result.ready);setOpenPassword('');setMessage(result.message);
    }catch(error){setMessage(error instanceof ApiError?error.message:'Could not open the training copy. Please try again.');}finally{setBusy(false);}
  }
  if(!available)return null;
  return <section aria-label="Move training" className="ops-trainer-transfer">
    <h3>Move training to another computer</h3>
    <p>The copy includes saved practice, accounts and progress from this browser. Use it with the same or a newer Operations Training app. Keep the file and password private.</p>
    <form onSubmit={save}>
      <label>New copy password<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={password} onChange={event=>setPassword(event.target.value)} disabled={busy||pending}/></label>
      <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy||pending}/></label>
      <button type="submit" disabled={busy||pending}>Save complete training copy</button>
    </form>
    <details><summary>Open a training copy on this computer</summary>
      <p>Your current training will be kept as an earlier copy. Save any open work, then close and reopen the app after importing. Sign in with the copied training accounts.</p>
      <form onSubmit={open}>
        <label>Training copy<input type="file" accept=".hotraining" required disabled={busy||pending} onChange={event=>setFile(event.target.files?.[0]||null)}/></label>
        <label>Copy password<input type="password" autoComplete="off" minLength={12} maxLength={200} required value={openPassword} onChange={event=>setOpenPassword(event.target.value)} disabled={busy||pending}/></label>
        <button type="submit" disabled={busy||pending}>Open complete training copy</button>
      </form>
    </details>
    {message&&<p role="status">{message}</p>}
  </section>;
}
