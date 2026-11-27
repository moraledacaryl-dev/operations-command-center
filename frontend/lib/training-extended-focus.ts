import type {TrainingWorkflowSession} from './training-workflows';
import type {WorkflowFocus} from './training-workflow-focus';
export function extendedWorkflowFocus(session:TrainingWorkflowSession,onModule:boolean):WorkflowFocus{
  const target=(selector:string,text?:string)=>({selector,...(text?{containsText:text}:{})});
  if(!onModule)return {title:'Open the practice page',text:'Select Open to continue this task.',targets:[target('[data-testid="training-open-module"]')]};
  if(session.kind==='decision-review'){
    if(!session.recordId)return {title:'Open the colleague requests',text:'Select Open practice requests.',targets:[target('[data-testid="training-prepare-review"]')]};
    const title=session.step===0?'Missing supplier quote':'Checked supplier quote';
    const field=document.querySelector<HTMLTextAreaElement>('.drawer-backdrop textarea');
    const action=session.step===0?'Reject':'Approve';
    if(field&&field.value.trim().length<12)return {title:'Explain the decision',text:session.step===0?'Explain that the supplier quote is missing.':'Record that the supplier quote was checked.',targets:[target('.drawer-backdrop textarea')]};
    return {title:'Review '+title,text:'Read this request, choose '+action+', close its details and check your work.',targets:[target('.drawer-backdrop button',action),target('.ops-work-card',title+' '+session.reference),target('[data-testid="training-check-work"]')]};
  }
  if(session.kind==='project-plan'&&session.step>0){
    const field=document.querySelector<HTMLTextAreaElement>('[aria-label="Discussion message"]');
    if(field&&(!field.value.includes(session.reference)||field.value.trim().length<session.reference.length+20))return {title:'Write the next project action',text:'Describe what to prepare next and include '+session.reference+'.',targets:[target('[aria-label="Discussion message"]')]};
    return {title:'Post the planning note',text:'Select Post, then check your saved work.',targets:[target('.event-composer button','Post'),target('[data-testid="training-check-work"]')]};
  }
  if(session.kind==='marketing-review'&&session.step===0){
    const root='.marketing-workspace .marketing-form:has(input[name="concept-title"])';
    const form=document.querySelector(root);
    if(!form)return {title:'Create the practice post',text:'Select New content.',targets:[target('button','New content')]};
    const title=form.querySelector<HTMLInputElement>('input[name="concept-title"]');
    if(!title?.value.includes(session.reference))return {title:'Include your practice number',text:'Write a clear Post title with '+session.reference+'.',targets:[target(root+' input[name="concept-title"]')]};
    const checks=Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(input=>input.parentElement?.textContent?.trim());
    if(checks.length!==2||!checks.includes('Pool')||!checks.includes('Facebook'))return {title:'Choose the area and platform',text:'Select Pool only and Facebook only.',targets:[target(root+' fieldset')]};
    const format=form.querySelector<HTMLSelectElement>('.form-grid label:nth-child(4) select');
    if(format?.value!=='Static')return {title:'Choose Static format',text:'Use Static for this post.',targets:[target(root+' .form-grid label:nth-child(4) select')]};
    if(!form.querySelector<HTMLInputElement>('input[type="date"]')?.value)return {title:'Set the publishing date',text:'Choose the date for this practice.',targets:[target(root+' input[type="date"]')]};
    const caption=form.querySelectorAll<HTMLTextAreaElement>('textarea')[1];
    if((caption?.value.trim().length||0)<20)return {title:'Write the caption',text:'Describe the made-up Pool offer.',targets:[target(root+' textarea')]};
    return {title:'Save the post',text:'Select Create 1 post, then Check saved work.',targets:[target(root+' button','Create 1 post'),target('[data-testid="training-check-work"]')]};
  }
  if(session.step===0){
    const root='[data-testid="create-project-form"]';const form=document.querySelector(root);
    if(!form)return {title:'Create the practice project',text:'Select New project.',targets:[target('button','New project')]};
    if(!form.querySelector<HTMLInputElement>('input')?.value.includes(session.reference))return {title:'Include your practice number',text:'Write a clear title with '+session.reference+'.',targets:[target(root+' input')]};
    if(form.querySelector<HTMLSelectElement>('select')?.value!=='High')return {title:'Choose High priority',text:'Choose High for this practice project.',targets:[target(root+' select')]};
    if(!form.querySelector<HTMLInputElement>('input[type="date"]')?.value)return {title:'Set the due date',text:'Choose the date for this practice.',targets:[target(root+' input[type="date"]')]};
    if((form.querySelector<HTMLTextAreaElement>('textarea')?.value.trim().length||0)<20)return {title:'Describe the preparation',text:'Write a short sentence about the work.',targets:[target(root+' textarea')]};
    return {title:'Save the project',text:'Select Create project, then Check saved work.',targets:[target(root+' button','Create project'),target('[data-testid="training-check-work"]')]};
  }
  const action=session.step===1?'Start draft':'Submit review';
  return {title:action,text:'Open the same Pool post, select '+action+', close its details and check your work.',targets:[target('.drawer-backdrop button',action),target('.marketing-workspace button',session.reference),target('[data-testid="training-check-work"]')]};
}
