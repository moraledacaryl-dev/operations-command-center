// The seed copy is checked against this file in backend training tests.
import cases from './shift-challenge-cases.json';
import { api, Entity } from './api';
import { assessPractice, PracticeAnswers, PracticeScenario } from './practice-scenarios';

export const SHIFT_CHALLENGE_EVENT = 'ho-shift-challenge-changed';
export const SHIFT_CHALLENGE_PATH = '/training/shift-challenge';
export type ShiftCase = (typeof cases)[number];
export type ShiftAnswers = { status: string; priority: string; team: string; decision: string; owner: string; followUp: string; note: string };
export type ShiftAttempt = {
  reference: string; taskId: number; handoverId: number; noticeId: number;
  startedAt: string; openedTask: boolean; openedHandover: boolean;
  answers: ShiftAnswers; commentId?: number; completedAt?: string;
};
export const emptyShiftAnswers = (): ShiftAnswers => ({ status:'',priority:'',team:'',decision:'',owner:'',followUp:'',note:'' });
export const shiftChallengeKey = (user: Entity) => 'ho-independent-shift-v1:' + String(user.id || user.email);
export const shiftTaskTitle = (c: ShiftCase) => '[TRAINING] ' + c.reference + ' — ' + c.title;
export const shiftHandoverTitle = (c: ShiftCase) => '[TRAINING] ' + c.reference + ' — shift handover';
export const shiftNoticeTitle = (c: ShiftCase) => '[TRAINING] ' + c.reference + ' — shift notice';
export function shiftCaseFor(user: Entity): ShiftCase | undefined {
  if (String(user.role).toLowerCase() !== 'staff') return;
  const dept = user.departments?.find((d: Entity) => Number(d.id) === Number(user.primary_department_id)) || user.departments?.[0];
  return cases.find(c => c.department === dept?.name);
}
export function readShiftAttempt(raw: string | null, c: ShiftCase): ShiftAttempt | null {
  try {
    const a = JSON.parse(raw || 'null');
    if (!a || a.reference !== c.reference || ![a.taskId,a.handoverId,a.noticeId].every(x => Number.isSafeInteger(x) && x > 0) ||
      !Number.isFinite(Date.parse(a.startedAt)) || !a.answers || Object.keys(emptyShiftAnswers()).some(k => typeof a.answers[k] !== 'string' || a.answers[k].length > 4000)) return null;
    return {reference:a.reference,taskId:a.taskId,handoverId:a.handoverId,noticeId:a.noticeId,startedAt:a.startedAt,
      openedTask:a.openedTask === true,openedHandover:a.openedHandover === true,answers:a.answers,
      ...(Number.isSafeInteger(a.commentId) && a.commentId > 0 ? {commentId:a.commentId}:{}),
      ...(typeof a.completedAt === 'string' && Number.isFinite(Date.parse(a.completedAt)) ? {completedAt:a.completedAt}:{})};
  } catch { return null; }
}
const noteHints: Record<string, [string, string]> = {
  'Front Desk': ['the hot water or shower problem', 'who will inspect it'],
  'Housekeeping': ['the wet floor or bathroom', 'the dry-floor check'],
  'Café': ['the delayed order or table', 'the Kitchen check or guest update'],
  'Kitchen': ['that the dessert must be kept out of service', 'the ingredient or allergy check'],
  'Maintenance': ['that people must be kept away', 'the qualified inspection'],
  'Marketing': ['the wrong event date', 'the lead’s review of the draft'],
  'Security': ['the blocked exit', 'the action to clear the exit'],
};
export function assessShiftNote(c: ShiftCase, a: ShiftAnswers): Record<string,string> {
  const scenario: PracticeScenario = {id:c.reference,department:c.department as PracticeScenario['department'],level:3,
    title:c.title,situation:c.situation,goal:'Leave a useful follow-up.',context:[],reference:c.reference,
    priority:c.priority as PracticeScenario['priority'],route:c.team as PracticeScenario['route'],decision:c.decision as PracticeScenario['decision'],
    example:'',why:c.why,noteChecks:c.checks.map((alternatives,i)=>({label:noteHints[c.department]?.[i] || 'the next check',alternatives}))};
  const result = assessPractice(scenario,{priority:a.priority as PracticeAnswers['priority'],department:a.team as PracticeAnswers['department'],decision:a.decision as PracticeAnswers['decision'],owner:a.owner,followUp:a.followUp,note:a.note});
  const errors: Record<string,string> = {...result.errors};
  if (!a.status) errors.status = 'Choose the status you read on the handover.';
  if (errors.owner) errors.owner = 'Name the responsible role, such as the on-duty ' + c.department + ' lead.';
  if (errors.note && (a.note.trim().length < 45 || errors.note.includes('characters'))) errors.note = 'Describe the unfinished problem and what someone needs to do next. A word such as done does not explain the follow-up.';
  if (errors.priority) errors.priority = c.why;
  if (errors.department) {errors.team = !a.team ? 'Choose the team for this situation.' : 'Check who should handle the next step. ' + c.help;delete errors.department;}
  if (!errors.followUp && !/\b(?:now|immediately|before|after|today|shift|minutes?|hours?|am|pm)\b|\d\s*[:.]\s*\d/i.test(a.followUp))
    errors.followUp = 'Add when the next check is due, such as in ten minutes or before service.';
  // A role cannot report an unchecked repair, room or allergy order as finished.
  if (/\b(?:fixed|repaired|safe|ready|cleared|resolved|completed)\b/i.test(a.note) &&
      /\b(?:is|are|was|now|already|has been)\s+(?:fully\s+)?(?:fixed|repaired|safe|ready|cleared|resolved|completed)\b/i.test(a.note) &&
      !/\b(?:not|isn't|aren't|wasn't)\s+(?:yet\s+)?(?:fixed|repaired|safe|ready|cleared|resolved|completed)\b/i.test(a.note)) {
    errors.note = 'The story says the check is still pending. Describe what needs checking without saying the work is finished.';
  }
  return errors;
}
export async function shiftRecords(user: Entity,c: ShiftCase,a?: ShiftAttempt) {
  const dept = Number(user.primary_department_id || user.departments?.[0]?.id);
  const [tasks,handovers,notices] = await Promise.all([
    a ? api.get('tasks',a.taskId).then(x=>[x]) : api.listAll('tasks',{department_id:dept,active:true}),
    a ? api.get('shift-notes',a.handoverId).then(x=>[x]) : api.listAll('shift-notes',{department_id:dept,active:true}),
    api.listAll('notifications',{limit:100}),
  ]);
  const task = tasks.find(x=>x.title===shiftTaskTitle(c) && Number(x.assigned_to_id)===Number(user.id) && Number(x.department_id)===dept && !x.hidden_from_active);
  const handover = handovers.find(x=>x.title===shiftHandoverTitle(c) && Number(x.department_id)===dept && !x.hidden_from_active);
  const notice = notices.find((x:Entity)=>x.title===shiftNoticeTitle(c) && x.kind==='Shift notice' && Number(x.user_id)===Number(user.id) && (!a || Number(x.id)===a.noticeId) && !x.dismissed_at);
  if (!task || !handover || !notice) throw new Error('Your shift practice records are not available. Ask your trainer to check the training app. Your earlier work will stay saved.');
  return {task,handover,notice};
}
export function savedShiftBody(c: ShiftCase,a: ShiftAnswers) {
  return c.reference + '\n' + a.note.trim() + '\nResponsible: ' + a.owner.trim() + '\nNext check: ' + a.followUp.trim();
}
export function verifyShiftEvidence(user: Entity,c: ShiftCase,a: ShiftAttempt,records:{task:Entity;handover:Entity;notice:Entity}): string[] {
  const errors:string[]=[];
  const departmentId=Number(user.primary_department_id || user.departments?.[0]?.id);
  if (Number(records.task.id)!==a.taskId || Number(records.task.assigned_to_id)!==Number(user.id) ||
      Number(records.task.department_id)!==departmentId || records.task.title!==shiftTaskTitle(c) ||
      Number(records.handover.id)!==a.handoverId || Number(records.handover.department_id)!==departmentId ||
      records.handover.title!==shiftHandoverTitle(c) || Number(records.notice.id)!==a.noticeId ||
      Number(records.notice.user_id)!==Number(user.id) || records.notice.kind!=='Shift notice' || records.notice.title!==shiftNoticeTitle(c))
    errors.push('These records do not match your assigned shift challenge. Ask your trainer to check the practice records.');
  if (!a.openedHandover) errors.push('Open the named handover and read it before finishing.');
  if (!a.openedTask) errors.push('Open your assigned job in My Work and read its details.');
  if (a.answers.status!==records.handover.status) errors.push('The handover status does not match. Open that handover and check again.');
  if (!records.notice.read_at) errors.push('Your shift notice is still unread. Open Notifications and use Mark read on the named notice.');
  const comment=records.task.comments?.find((x:Entity)=> Number(x.author_id)===Number(user.id) && x.comment_type==='Shift follow-up' && x.body===savedShiftBody(c,a.answers) && Number(x.id)===a.commentId && Date.parse(x.created_at)>=Date.parse(a.startedAt)-1000);
  if (!comment) errors.push('Your follow-up has not been found on this job. Save it below, then check again.');
  return errors;
}
