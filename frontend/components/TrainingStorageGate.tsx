'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {api,ApiError,type Entity} from '@/lib/api';
import {restoreTrainingCopy} from '@/lib/training-copy';

export function TrainingStorageGate({user,children}:{user:Entity;children:ReactNode}) {
  const [ready,setReady]=useState(false);
  const [error,setError]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;setReady(false);setError(false);
    api.trainingProfile().then(profile=>{
      if(!active)return;
      restoreTrainingCopy(localStorage,String(user.id),profile);setReady(true);
    }).catch(cause=>{
      if(!active)return;
      // The hosted practice app has no native profile to transfer.
      if(cause instanceof ApiError && cause.status===404)setReady(true);else setError(true);
    });
    return ()=>{active=false;};
  },[user.id,retry]);
  if(error)return <main id="workspace-main" className="main"><p role="alert">Your training progress could not be opened. Ask your trainer for help.</p><button type="button" onClick={()=>setRetry(value=>value+1)}>Try again</button></main>;
  if(!ready)return <main id="workspace-main" className="main"><p role="status">Opening your training…</p></main>;
  return children;
}
