import type {TrainingWorkflowSession,WorkflowCheck} from './training-workflows';

export type ExtendedTrainingKind = 'project-plan' | 'marketing-review' | 'decision-review';
export const EXTENDED_WORKFLOWS = {
  'project-plan': {name:'Create a project and its first planning note',path:'/projects',resource:'projects',stages:['Save the project plan','Post the next action in its discussion']},
  'marketing-review': {name:'Prepare a post for review',path:'/posts',resource:'posts',stages:['Save a Pool promotion','Start its draft','Send the same post for review']},
  'decision-review': {name:'Review two colleague requests',path:'/approvals',resource:'approvals',stages:['Reject a request missing its quote','Approve a request with a checked quote']},
} as const;
export const EXTENDED_PREFIXES = {'project-plan':'TRN-PROJECT-','marketing-review':'TRN-POST-','decision-review':'TRN-DECISION-'} as const;
export function isExtendedTrainingKind(value:unknown):value is ExtendedTrainingKind{return typeof value==='string'&&Object.prototype.hasOwnProperty.call(EXTENDED_WORKFLOWS,value)}
type Row=Record<string,unknown>;
const text=(v:unknown)=>String(v??'').trim().toLowerCase();
const id=(v:unknown)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):0;

export function verifyExtendedWorkflow(session:TrainingWorkflowSession,candidates:Row[],detail?:Row|null,related?:Row|null,relatedRows:Row[]=[]):WorkflowCheck{
  const ref=session.reference.toLowerCase();
  if(session.kind==='decision-review'){
    const expected=session.step===0?'rejected':'approved';
    const expectedId=session.step===0?session.recordId:session.relatedRecordId;
    const expectedTitle=session.step===0?'missing supplier quote':'checked supplier quote';
    const valid=!!expectedId&&!!detail&&id(detail.id)===expectedId&&text(detail.title).includes(ref)&&text(detail.title).includes(expectedTitle)&&
      text(detail.source_type)==='ops_need'&&text(detail.status)===expected&&id(detail.decided_by_id)===id(session.ownerId)&&
      text(detail.decision_note).length>=12&&/quote|quotation/.test(text(detail.decision_note))&&
      !!related&&id(related.id)===id(detail.source_id)&&text(related.status)===expected&&
      id(related.requested_by_id)>0&&id(related.requested_by_id)!==id(session.ownerId)&&id(detail.requested_by_id)===id(related.requested_by_id);
    return {passed:valid,error:valid?'':session.step===0?'Open the Missing supplier quote request in Approvals. Reject it with a clear note about the missing quote.':'Open the Checked supplier quote request. Read the provided details, then approve it with a note about the checked quote.'};
  }
  const marketingValid=(row:Row,status:string)=>{
    const deliverables=Array.isArray(row.deliverables)?row.deliverables as Row[]:[];
    const delivery=deliverables[0];
    return deliverables.length===1&&!!delivery&&text(delivery.platform)==='facebook'&&text(delivery.format)==='static'&&!!delivery.scheduled_at&&text(delivery.caption).length>=20&&text(delivery.status)===status&&
      (!session.relatedRecordId||id(delivery.id)===session.relatedRecordId)&&Array.isArray(row.marketing_areas)&&row.marketing_areas.length===1&&row.marketing_areas[0]==='Pool';
  };
  if(session.step===0){
    const row=candidates.find(row=>id(row.id)>0&&text(row.title).includes(ref)&&!row.hidden_from_active&&(
      session.kind==='project-plan'?
        text(row.status)==='planned'&&text(row.priority)==='high'&&!!row.due_date&&text(row.note).length>=20:
        marketingValid(row,'planned')));
    return row?{passed:true,error:'',recordId:id(row.id),...(session.kind==='marketing-review'?{relatedRecordId:id((row.deliverables as Row[])[0].id)}:{})}:{passed:false,error:session.kind==='project-plan'?'Save a Planned project with your practice number, High priority, a due date and a short description of the work.':'Save a post with your practice number, a campaign, Facebook as its only platform, Static format, a publishing date, a caption and Pool as its only area.'};
  }
  if(!detail||id(detail.id)!==session.recordId||!text(detail.title).includes(ref)||detail.hidden_from_active)return {passed:false,error:'Open the original saved record for this practice.'};
  if(session.kind==='project-plan'){
    const comment=relatedRows.find(row=>id(row.parent_id)===session.recordId&&text(row.parent_type)==='projects'&&id(row.id)>0&&id(row.author_id)===id(session.ownerId)&&text(row.body).includes(ref)&&text(row.body).length>=session.reference.length+20);
    return comment?{passed:true,error:'',relatedRecordId:id(comment.id)}:{passed:false,error:'Open the saved project. In Discussion, post a next-action note with your practice number.'};
  }
  const expected=session.step===1?'draft':'review';
  const passed=marketingValid(detail,expected);
  return {passed,error:passed?'':session.step===1?'Open the saved Pool post and choose Start draft.':'Send the same draft for review. Keep its Pool area and caption; do not publish it.'};
}

export function extendedWorkflowInstructions(session:TrainingWorkflowSession):string[]{
  if(session.kind==='project-plan')return session.step===0?
    ['Open Projects and select New project.','Include the practice number in the title. Choose High priority and a due date.','In Notes, describe the event preparation and the next work needed. Select Create project, then Check saved work.']:
    ['Open that same project. In Discussion, describe the next preparation action and include your practice number.','Select Post, then Check saved work.'];
  if(session.kind==='marketing-review')return session.step===0?
    ['Open Marketing and select New content. Choose an existing practice campaign.','Include your practice number in Post title. Choose Static, a date shown on this month’s calendar, Pool only and Facebook only.','Write a caption for a made-up Pool offer. Select Create 1 post, then Check saved work.']:
    session.step===1?['Find the same post on its calendar date. Open it and select Start draft. Close the details, then Check saved work.']:
    ['Check the date, caption and Pool area on the same draft. Select Submit review, close the details, then Check saved work.','Leave publication to the authorized reviewer.'];
  return session.step===0?
    ['Select Open practice requests to prepare two requests from a colleague.','In Approvals, find Missing supplier quote with this practice number and read its details.','Reject it with a note explaining that the supplier quote is missing. Then Check saved work.']:
    ['Find Checked supplier quote with this practice number in Approvals.','Its practice quote and amount have been checked. Read the details, approve it and write a note about the checked quote.','Then Check saved work. Approval does not mean the goods were delivered.'];
}
