import {expect,test} from '@playwright/test';
import {restoreTrainingCopy,trainingCopyStorage} from '../lib/training-copy';
function store(){const values=new Map<string,string>();return {get length(){return values.size},key:(index:number)=>Array.from(values.keys())[index]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
test('a complete copy restores only this learner before mounting and retains earlier browser work',()=>{
  const storage=store();storage.setItem('cc_user','keep sign in');storage.setItem('ho-ops-structured-course-v2:1','{"old":true}');storage.setItem('ho-ops-structured-course-v2:2','{"other":true}');
  const progress={'ho-ops-scenario-practice-v1:1:last':'front-desk-arrival','ho-ops-scenario-practice-v1:1:guide-intro-v2':'yes','ho-ops-handbook-training-v1:1':'completed','ho-ops-verified-workflow-v1:1':'{"recordId":415,"step":1}','ho-ops-room-arrivals-practice-v1:evidence:1':'{"finished":true}'};
  restoreTrainingCopy(storage,'1',{profile_id:'a'.repeat(32),restore_id:'b'.repeat(32),storage:progress});
  expect(storage.getItem('ho-ops-structured-course-v2:1')).toBeNull();expect(storage.getItem('cc_user')).toBe('keep sign in');expect(storage.getItem('ho-ops-structured-course-v2:2')).toBe('{"other":true}');
  expect(trainingCopyStorage(storage,'1')).toEqual(progress);
  const archive=storage.getItem('ho-training-before-transfer-v1:1:'+'a'.repeat(32)+':'+'b'.repeat(32));expect(JSON.parse(archive!).storage['ho-ops-structured-course-v2:1']).toBe('{"old":true}');
  storage.setItem('ho-ops-verified-workflow-v1:1','{"step":2}');restoreTrainingCopy(storage,'1',{profile_id:'a'.repeat(32),restore_id:'b'.repeat(32),storage:progress});
  expect(storage.getItem('ho-ops-verified-workflow-v1:1')).toBe('{"step":2}');
  restoreTrainingCopy(storage,'1',{profile_id:'a'.repeat(32),restore_id:'c'.repeat(32),storage:progress});expect(storage.getItem('ho-ops-verified-workflow-v1:1')).toBe(progress['ho-ops-verified-workflow-v1:1']);
});
test('copy excludes authentication and refuses cross-user progress without changing saved work',()=>{
  const storage=store();storage.setItem('cc_user','secret');storage.setItem('ho-ops-structured-course-v2:1','{}');
  expect(trainingCopyStorage(storage)).toEqual({'ho-ops-structured-course-v2:1':'{}'});
  expect(()=>restoreTrainingCopy(storage,'1',{profile_id:'a',restore_id:'b',storage:{'ho-ops-structured-course-v2:2':'{}'}})).toThrow();expect(storage.getItem('ho-ops-structured-course-v2:1')).toBe('{}');
});
test('full browser storage rolls a failed restore back and keeps the prior copy',()=>{
  const storage=store();storage.setItem('ho-ops-structured-course-v2:1','{"earlier":true}');const save=storage.setItem;let failed=false;
  storage.setItem=(key,value)=>{if(!failed&&key==='ho-ops-verified-workflow-v1:1'){failed=true;throw new Error('Quota')}save(key,value)};
  expect(()=>restoreTrainingCopy(storage,'1',{profile_id:'a',restore_id:'b',storage:{'ho-ops-verified-workflow-v1:1':'{}'}})).toThrow();expect(storage.getItem('ho-ops-structured-course-v2:1')).toBe('{"earlier":true}');
});
