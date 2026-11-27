import {expect,test} from '@playwright/test';
import {verifyWorkflowStep,WORKFLOW_REFERENCE_PREFIXES,parseWorkflowSession} from '../lib/training-workflows';
import type {TrainingWorkflowSession} from '../lib/training-workflows';
import {readCourseProgress} from '../lib/training-course';
import {TRAINING_LESSONS} from '../lib/interactive-training';

function session(kind:TrainingWorkflowSession['kind'],step=0):TrainingWorkflowSession{return {kind,ownerId:'77',reference:WORKFLOW_REFERENCE_PREFIXES[kind]+'ABC12345',createdAt:new Date().toISOString(),step,recordId:501,relatedRecordId:502}}

test('project practice needs a saved plan and a discussion authored by the learner',()=>{
 const s=session('project-plan');const project={id:501,title:'Event '+s.reference,status:'Planned',priority:'High',due_date:'2026-12-10',note:'Prepare the courtyard for the practice event.'};
 expect(verifyWorkflowStep(s,[]).passed).toBe(false);expect(verifyWorkflowStep(s,[project]).passed).toBe(true);
 const comment={id:601,parent_type:'projects',parent_id:501,author_id:77,body:'Prepare seating before the event '+s.reference};
 expect(verifyWorkflowStep({...s,step:1},[],project,null,[]).passed).toBe(false);
 expect(verifyWorkflowStep({...s,step:1},[],project,null,[{...comment,parent_id:999}]).passed).toBe(false);
 expect(verifyWorkflowStep({...s,step:1},[],project,null,[{...comment,author_id:88}]).passed).toBe(false);
 expect(verifyWorkflowStep({...s,step:1},[],project,null,[comment]).passed).toBe(true);
});

test('Marketing practice requires the original concept and Facebook deliverable to reach Review',()=>{
 const s=session('marketing-review');const delivery={id:502,concept_id:501,status:'Planned',platform:'Facebook',format:'Static',scheduled_at:'2026-12-10T09:00:00+08:00',caption:'Practice Pool offer; confirm the date before review.'};
 const post={id:501,title:'Pool offer '+s.reference,marketing_areas:['Pool'],deliverables:[delivery]};
 const state=(status:string,changes={})=>({...post,deliverables:[{...delivery,status,...changes}]});
 expect(verifyWorkflowStep(s,[]).passed).toBe(false);expect(verifyWorkflowStep(s,[{...post,marketing_areas:['Bar']}]).passed).toBe(false);expect(verifyWorkflowStep(s,[post]).passed).toBe(true);
 expect(verifyWorkflowStep({...s,step:1},[],post).passed).toBe(false);expect(verifyWorkflowStep({...s,step:1},[],state('Draft')).passed).toBe(true);
 expect(verifyWorkflowStep({...s,step:2},[],state('Published')).passed).toBe(false);
 expect(verifyWorkflowStep({...s,step:2},[],state('Review',{id:999})).passed).toBe(false);
 expect(verifyWorkflowStep({...s,step:2},[],{...state('Review'),id:999}).passed).toBe(false);
 expect(verifyWorkflowStep({...s,step:2},[],state('Review')).passed).toBe(true);
});

for(const step of [0,1])test(`decision stage ${step+1} needs the correct colleague source, outcome and actual decision maker`,()=>{
 const s=session('decision-review',step);const expected=step===0?'Rejected':'Approved';
 const approval={id:step===0?501:502,title:(step===0?'Missing supplier quote ':'Checked supplier quote ')+s.reference,status:expected,source_type:'ops_need',source_id:901,requested_by_id:88,decided_by_id:77,decision_note:'Supplier quote '+(step===0?'is missing.':'was checked.')};
 const source={id:901,status:expected,requested_by_id:88};
 expect(verifyWorkflowStep(s,[],{...approval,status:'Pending'},source).passed).toBe(false);
 expect(verifyWorkflowStep(s,[],{...approval,decided_by_id:88},source).passed).toBe(false);
 expect(verifyWorkflowStep(s,[],approval,{...source,id:902}).passed).toBe(false);
 expect(verifyWorkflowStep(s,[],{...approval,requested_by_id:77},{...source,requested_by_id:77}).passed).toBe(false);
 expect(verifyWorkflowStep(s,[],approval,source).passed).toBe(true);
});

test('new practice preserves older completion history and keeps unrelated skills',()=>{
 const old={lessonId:'orientation',stage:'finished',question:0,passed:TRAINING_LESSONS.map(l=>l.id),metrics:{projects:{completedAt:'2026-11-01T00:00:00Z'}}};
 const progress=readCourseProgress(JSON.stringify(old),TRAINING_LESSONS);
 expect(progress.passed).toContain('orientation');expect(progress.passed).not.toContain('projects');
 expect(progress.earlierPassed).toEqual(expect.arrayContaining(['projects','marketing','management-review']));
 expect(progress.metrics?.projects?.completedAt).toBe(old.metrics.projects.completedAt);
 expect(progress.stage).toBe('finished');
 const current=readCourseProgress(JSON.stringify({...progress,passed:TRAINING_LESSONS.map(l=>l.id)}),TRAINING_LESSONS);
 expect(current.passed).toContain('projects');
});

for(const kind of ['project-plan','marketing-review','decision-review'] as const)test(`interrupted ${kind} keeps its bound records`,()=>{
 const s=session(kind,1);expect(parseWorkflowSession(JSON.stringify(s),'77')).toEqual(s);
 expect(parseWorkflowSession(JSON.stringify(s),'88')).toBeNull();
});
