import { test,expect } from '@playwright/test';
import cases from '../lib/shift-challenge-cases.json';
import { assessShiftNote,emptyShiftAnswers,readShiftAttempt,savedShiftBody,shiftCaseFor,shiftHandoverTitle,shiftNoticeTitle,shiftTaskTitle,verifyShiftEvidence } from '../lib/training-shift-challenge';
import { modelShiftAnswers } from './shift-challenge-fixtures';
import type { ShiftAttempt } from '../lib/training-shift-challenge';

for(const c of cases)test(c.department+' shift: useful response passes; incomplete, unsafe and wrong decisions fail',()=>{
 const a=modelShiftAnswers(c);expect(assessShiftNote(c,a)).toEqual({});
 for(const field of ['priority','team','decision','owner','followUp','note'] as const){const errors=assessShiftNote(c,{...a,[field]:field==='note'?'ok':''});expect(errors[field],field).toBeTruthy();}
 expect(assessShiftNote(c,{...a,followUp:'The lead will check and report the result.'}).followUp).toContain('when');
 expect(assessShiftNote(c,{...a,note:c.reference+': The problem is fixed and the area is safe. The '+a.note}).note).toBeTruthy();
});
test('completion requires opened records, the employee’s saved comment and read notice, including after refresh',()=>{
 const c=cases[0],answers=modelShiftAnswers(c),user={id:12,role:'staff',primary_department_id:2,departments:[{id:2,name:c.department}]};
 const a:ShiftAttempt={reference:c.reference,taskId:90,handoverId:50,noticeId:100,startedAt:'2026-11-03T09:00:00Z',openedTask:true,openedHandover:true,answers,commentId:120};
 const records={task:{id:90,title:shiftTaskTitle(c),department_id:2,assigned_to_id:12,comments:[{id:120,author_id:12,comment_type:'Shift follow-up',body:savedShiftBody(c,answers),created_at:'2026-11-03T09:01:00Z'}]},handover:{id:50,title:shiftHandoverTitle(c),department_id:2,status:'Follow'},notice:{id:100,title:shiftNoticeTitle(c),kind:'Shift notice',user_id:12,read_at:'2026-11-03T09:01:00Z'}};
 expect(verifyShiftEvidence(user,c,a,records)).toEqual([]);
 expect(verifyShiftEvidence(user,c,{...a,openedTask:false,openedHandover:false},records)).toHaveLength(2);
 expect(verifyShiftEvidence(user,c,a,{...records,notice:{...records.notice,read_at:null}})).toHaveLength(1);
 expect(verifyShiftEvidence(user,c,a,{...records,task:{...records.task,comments:[{...records.task.comments[0],author_id:13}]}})).toHaveLength(1);
 expect(verifyShiftEvidence(user,c,a,{...records,task:{...records.task,assigned_to_id:13}})).not.toEqual([]);
 expect(verifyShiftEvidence(user,c,{...a,answers:{...answers,status:'Done'}},records)).not.toEqual([]);
 expect(readShiftAttempt(JSON.stringify({...a,completedAt:'2026-11-03T09:02:00Z'}),c)?.completedAt).toBeTruthy();
 expect(readShiftAttempt(JSON.stringify({...a,taskId:-1}),c)).toBeNull();
 expect(shiftCaseFor({...user,role:'manager'})).toBeUndefined();
});
