import type { TrainingLesson } from './interactive-training';
import type { TrainingWorkflowKind } from './training-workflows';

export type CheckQuestion = {
  prompt: string;
  choices: readonly [string, string, string];
  correct: 0 | 1 | 2;
  explanation: string;
};
export type CourseGuide = {
  explanation: string;
  incorrectExample?: string;
  repeatVariant?: { example: string; questions: readonly [CheckQuestion,CheckQuestion] };
  whyIncorrect?: string;
  branches?: readonly { question: string; choices: readonly [string,string,string]; correct: 0|1|2; response: string }[];
  example: string;
  remember: string;
  questions: readonly [CheckQuestion, CheckQuestion];
  handsOn?: TrainingWorkflowKind;
};
const q = (prompt: string, choices: [string,string,string], correct: 0|1|2, explanation: string): CheckQuestion =>
  ({ prompt, choices, correct, explanation });

/** Plain-language preparation comes BEFORE the real-screen practical tour.
 * No answers are entered for the trainee and the course cannot be passed by reading alone.
 */
export const COURSE_GUIDES: Record<string, CourseGuide> = {
  orientation: {
    explanation: 'This is the real Operations layout with pretend guest and employee information. My Work shows tasks assigned to you. Notifications tells you when something needs your attention. The Hidden Oasis logo returns you to the main page.',
    example: 'You arrive for your shift. You need to see your assigned tasks, check any important new messages, then return to the dashboard.',
    repeatVariant: { example:'The next shift starts and you need to find one assigned task, read a new alert, and return home without changing anything.', questions:[
      q('Which control normally takes you back to the dashboard?', ['The My Work link','The Hidden Oasis logo','The department menu'],1,'The Hidden Oasis logo returns to the main dashboard.'),
      q('How do you find an alert about your assignments?', ['Use Notifications and read the related task','Check only the dashboard totals','Look at the previous shift note instead'],0,'Read the notification and related work with your own login.'),
    ] },
    remember: 'You will click the real My Work link, Notifications link and logo yourself. Clicking Next cannot replace these actions.',
    incorrectExample: 'An employee sees a red notification number, assumes the task is already done, and ignores it.',
    whyIncorrect: 'A notification is a message, not confirmation that a task was finished. Open the related task to see what still needs doing.',
    questions: [
      q('Where do you go first to see tasks assigned to you?', ['My Work','Rooms','Marketing'], 0, 'My Work shows assignments for your own account.'),
      q('You read a notification about unfinished work. What should you do?', ['Wait for another notification before opening it','Read the related task and check what still needs doing','Look only at the notification and close it'], 1, 'A notification tells you something changed. Read the underlying work before deciding what is needed.'),
    ],
  },
  'staff-handover': {
    explanation: 'A handover is a note from the employee finishing a shift to the employee starting the next one. It explains problems that are still unfinished, who is handling them and what to do next.',
    example: 'A guest reported a broken toilet. Reception has called Maintenance but the repair is not confirmed. The next receptionist needs to know what to check and when to update the guest.',
    remember: 'Reading a note is not the same as fixing the problem. Do not mark it finished until work really is confirmed.',
    incorrectExample: 'A receptionist sees a note saying the toilet repair is waiting, then tells the guest that it is fixed.',
    whyIncorrect: 'The note only records an unfinished problem. Staff need to ask the responsible team what actually happened.',
    branches: [{question:'What if Maintenance cannot come before the next shift?',
      choices:['Mark the repair complete','Tell the next receptionist who will follow up and update the guest','Delete the report'],
      correct:1, response:'The next employee must know the problem is still open and who will follow up with the guest.'}],
    questions: [
      q('What should a useful shift note tell the next employee?', ['The guest’s concern without a follow-up','The problem, who should act and what to check next','The next shift’s start time and room number'], 1, 'The next employee needs enough information to continue the work.'),
      q('You read a handover about a repair that is not checked yet. What should you do?', ['Assume it is repaired','Delete the note','Check the situation or tell the person responsible'], 2, 'An unresolved problem needs follow-up, not an assumed completion.'),
    ],
  },
  'staff-rooms': {
    explanation: 'The Rooms screen helps you find a guest room or shared area. Check the correct room number and any existing issues before reporting a new problem.',
    example: 'A guest calls from Solace. Search for Solace and check whether somebody has already reported the issue.',
    remember: 'Confirm the room number. Never use one guest’s room information for another guest.',
    questions: [
      q('Before reporting another problem for Solace, what should you check?', ['Whether the issue is already recorded','Whether the room is listed as occupied','Whether a different room has an open issue'], 0, 'Checking existing records helps staff avoid duplicate reports.'),
      q('Why should you confirm the room number?', ['To send the right team to the correct place','To choose the order in which rooms appear','To decide who works the next shift'], 0, 'The correct room number prevents wasted trips and mistaken guest updates.'),
    ],
  },
  'room-arrivals': {
    explanation: 'Room cleaning shows planned arrivals and departures, guest status and cleaning work separately. Front Desk records what actually happened. Housekeeping must wait until the guest has left before beginning a checkout clean.',
    example: 'A practice guest leaves Solace. Front Desk records checkout, Housekeeping cleans the room and an authorized supervisor checks the work before it can be released.',
    incorrectExample: 'A cleaner sees a departure planned for today and enters the room without confirming the guest checked out.',
    whyIncorrect: 'A plan is not proof that the guest has departed. Always check the recorded status and ask Front Desk when unsure.',
    remember: 'Recorded checkout is not the same as a clean room. Front Desk can correct a mistaken check-in or checkout, with a reason.',
    questions: [
      q('A guest is recorded as checked in. Can Housekeeping begin checkout cleaning?', ['No. First confirm with Front Desk','Yes, if someone is available to clean','Yes, if another arrival is expected'], 0, 'The guest could still be in the room. Check with Front Desk.'),
      q('A room was cleaned earlier but occupied again later. What does it need after the next checkout?', ['A fresh clean for the new departure','No cleaning because it was approved earlier','Only a change to the status label'], 0, 'Earlier cleaning was for a previous stay.'),
    ],
  },
  'staff-my-work': {
    explanation: 'My Work shows the jobs assigned to your account. Read the due date, urgency and instructions. If something is blocked, tell the appropriate lead instead of pretending it is complete.',
    example: 'An item due today is waiting for materials. Open it, understand what is missing, and tell the lead so they can help.',
    repeatVariant: { example:'You open My Work and see a job blocked because a part has not arrived. Report the blocker rather than falsely closing the task.', questions:[
      q('A task is Waiting for another team. What should you do?', ['Check the blocker and keep the responsible person informed','Delete it','Mark it done'],0,'Waiting is not the same as finished work.'),
      q('Where should you look for tasks assigned to your login?', ['My Work','The department task list','The shift handover'],0,'My Work shows your assigned workload.'),
    ] },
    remember: 'A task waiting for approval or another team is not automatically finished.',
    questions: [
      q('A task is due today but you cannot finish it. What should you do?', ['Say nothing until tomorrow','Tell the lead what is blocking it','Mark it done to clear the list'], 1, 'The responsible lead needs a truthful update so the issue can be addressed.'),
      q('What does a task marked Waiting normally mean?', ['It may still need something before work can finish','It is always fully completed','It should be deleted'], 0, 'Waiting means another action or dependency may be pending.'),
    ],
  },
  'maintenance-status': {
    explanation: 'Open means a repair is waiting. Working means the work started and appears as In progress on the board. Done means someone reported the repair finished, but it still needs checking. The board calls that To verify. Verified means an authorized person checked the repair.',
    example: 'A corridor light is marked Done. The lead still needs to check the result before it can become Verified.',
    incorrectExample: 'A technician tells Reception a repair is verified immediately after clicking Done.',
    whyIncorrect: 'A reported completion is not the same as an independent safety or quality check.',
    remember: 'Never report a repair as Verified unless the authorized inspection actually happened.',
    questions: [
      q('A repair is Done but not Verified. What does that mean?', ['The final check may still be pending','It has been independently approved','Nobody needs to check the work'], 0, 'Done and Verified mean different things.'),
      q('Who can mark the final check Verified?', ['An authorized person after checking','Anyone who opens the repair','The next guest to use the room'], 0, 'Only an authorized person may verify completed work.'),
    ],
  },
  'team-tasks': {
    explanation: 'A task is a specific job with a title, priority and person responsible. Search first so you do not create duplicates. When saving, make sure the correct teammate is actually assigned.',
    example: 'A shared job has no owner. Assign the right fictional teammate, start the work, and submit the saved task for review.',
    repeatVariant: { example:'A staff member reports a broken hallway sign but nobody is assigned. Find whether the job exists, assign the right fictional teammate, and follow its progress.', questions:[
      q('A task already exists for the same sign. What should you do?', ['Create a second copy','Review the existing task and update it if appropriate','Ignore both'],1,'Duplicate tasks confuse ownership.'),
      q('When can a task be submitted for review?', ['After it actually reaches the required work stage','The moment it is created without work','By changing the title only'],0,'Complete each step and save your changes.'),
    ] },
    remember: 'Your practice only counts after the app confirms your saved task really changed through the required stages.',
    handsOn: 'shared-no-owner',
    questions: [
      q('A task is unassigned and needs attention today. What matters most?', ['Assigning someone who will handle it','Leaving it open without an owner','Adding a deadline without telling anyone'], 0, 'Work can be forgotten when nobody is responsible.'),
      q('Before creating a task, what should you do?', ['Create duplicates to be safe','Search for an existing task','Mark somebody else’s task as done'], 1, 'Searching first reduces duplicate and conflicting work.'),
    ],
  },
  'guest-matters': {
    explanation: 'A guest matter is a record of a guest’s problem. A good record states what happened, which room or service is affected, who should investigate and when Reception will call the guest back.',
    example: 'Solace reports an AC that is blowing warm air. Record the complaint, arrange an inspection and keep the guest informed.',
    repeatVariant: { example:'A fictional guest in Twinspire says their bathroom sink is leaking. Nobody has inspected the room. Record what is known and arrange an update without promising a repair time.', questions:[
      q('The guest asks if the sink is already repaired. What should Reception say?', ['It was reported, so it should be fixed soon','We will confirm with Maintenance and update you','The request is closed because Maintenance was notified'],1,'Do not promise a finished repair before checking.'),
      q('What is useful in the guest matter?', ['Twinspire, leaking sink, responsible team and follow-up','Only the guest mood','A fake completion note'],0,'The right details help the next employee act.'),
    ] },
    remember: 'Do not claim the guest problem is solved before it has actually been checked.',
    incorrectExample: 'Reception tells the guest the air conditioner is repaired even though no technician has inspected it.',
    whyIncorrect: 'Promising a result that has not been checked can mislead the guest and hide an unfinished repair.',
    branches: [{question:'What if the guest says the room is too hot to stay in?',
      choices:['Ignore the new information','Ask the lead about safe immediate assistance or a room option and update the guest','Say maintenance will arrive at a made-up time'],
      correct:1, response:'New information can change the response. Ask an authorized lead for an appropriate immediate option.'}],
    handsOn: 'guest-ac',
    questions: [
      q('A guest says the AC is not cooling. What is a useful first step?', ['Record the fault and ask for inspection','Mark it repaired immediately','Promise it will never happen again'], 0, 'The team needs a clear report before the repair and follow-up can be checked.'),
      q('When should Reception say a fault was repaired?', ['After the actual repair is verified','As soon as the guest calls','Before Maintenance has looked'], 0, 'Staff should not promise a result that nobody has confirmed.'),
    ],
  },
  maintenance: {
    explanation: 'Maintenance records show what is broken, where it is and who is fixing it. Working means repair is underway. Done means somebody reports completion. Verified means authorized staff have checked the result.',
    example: 'A corridor light is out. Record the affected area, ask a fictional technician to inspect it and make sure the finished work is checked.',
    repeatVariant: { example:'The pool-side walkway light is out after rain. Do not touch wiring. Record the area, protect access if necessary and request a qualified inspection.', questions:[
      q('The affected light is next to a wet walkway. What comes first?', ['Protect people and alert a qualified person','Touch the wiring','Mark Verified immediately'],0,'Water near electricity may be unsafe.'),
      q('What is the difference between Done and Verified?', ['There is no difference','Done is reported completion; Verified is an authorized check','Verified means the form was opened'],1,'A real inspection is separate from a technician saying work is done.'),
    ] },
    remember: 'Never treat a digital training completion as proof that a real electrical repair was performed.',
    incorrectExample: 'A technician clicks Done on the work order without inspecting or testing the fault.',
    whyIncorrect: 'Clicking Done cannot prove a repair. A qualified person must inspect and an authorized person verifies the result.',
    branches: [{question:'What if the light fault is near water?',
      choices:['Keep using the area normally','Restrict access and urgently alert qualified personnel','Touch the wiring to test it'],
      correct:1, response:'Water and electricity may create an immediate hazard. Protect people and alert qualified personnel.'}],
    handsOn: 'mt-light-fault',
    questions: [
      q('A repair is marked Done but has not been tested. What does that mean?', ['A final check may still be needed','The building is definitely safe','The task should be forgotten'], 0, 'Done and Verified are different steps in the work process.'),
      q('What should a maintenance report include?', ['The exact location and what is not working','Only the employee’s nickname','An invented completed repair'], 0, 'A useful report identifies the defect and where staff need to inspect.'),
    ],
  },
  requests: {
    explanation: 'A request asks for something to be purchased or changed. Explain what is needed, why it matters and whether the price or quotation has been verified. Requesting approval is not approving your own request.',
    example: 'A department needs equipment but the supplier quotation is missing. Save the truthful reason and send it to an authorized reviewer.',
    repeatVariant: { example:'The kitchen requests replacement equipment but only has an estimate, not a supplier quote. Clearly describe what is missing before asking for review.', questions:[
      q('The supplier has not sent a price. What should the request say?', ['Quotation still pending','Exact final price confirmed','Management already approved'],0,'Missing information must be reported accurately.'),
      q('What does Send for review mean?', ['The item was delivered','The request is waiting for an authorized decision','The supplier has been paid'],1,'Submitting does not grant approval.'),
    ] },
    remember: 'Never invent supplier documents, prices, or approvals to finish practice.',
    incorrectExample: 'An employee writes “quotation attached” to make the request look complete, but no quotation exists.',
    whyIncorrect: 'The reviewer needs accurate information, including what is still missing, before deciding.',
    branches: [{question:'What if the supplier sends a different price later?',
      choices:['Hide the new price','Update the request with the new quoted price and explain the change','Approve it without checking'],
      correct:1, response:'Changes in price must be visible to the authorized reviewer.'}],
    handsOn: 'manager-evidence',
    questions: [
      q('A purchase request has no quotation. What should you write?', ['Clearly say the quotation is missing','Say one is attached even when it is not','Approve it yourself'], 0, 'The reviewer must know what evidence is and is not available.'),
      q('Does sending a request for review mean the purchase is already approved?', ['Yes, automatically','Only if someone says so in chat','No, approval is a separate authorized decision'], 2, 'Submitting a proposal and approving it are different actions.'),
    ],
  },
  'shift-writing': {
    explanation: 'A useful shift note tells the next employee what happened, who is supposed to handle it and when the guest or team needs another update.',
    example: 'A guest is still waiting for a toilet repair. Write who will contact Maintenance and who must call the guest back after the shift changes.',
    remember: 'Publishing a note does not automatically make the unfinished work go away.',
    incorrectExample: 'A receptionist leaves a note saying “Guest problem” without room, next action, or responsible person.',
    whyIncorrect: 'The next employee cannot act on such a vague note. Write the real problem and what should happen next.',
    handsOn: 'shift-unresolved',
    questions: [
      q('Which shift note would help the next receptionist most?', ['Crown toilet is broken; Maintenance will inspect; Front Desk will call the guest','Problem noted','Somebody will deal with something'], 0, 'A clear note identifies the issue, next action and responsibility.'),
      q('The guest problem is still not resolved when your shift ends. What should happen?', ['Pass it to the next shift with an owner','Mark it completed anyway','Delete the issue'], 0, 'Unfinished work must be passed on rather than hidden.'),
    ],
  },
  projects: {
    explanation: 'A project is a larger goal made up of smaller steps, such as preparing an event. Use a clear objective, deadline and responsible team. Read existing projects before adding a new one.',
    example: 'The resort is preparing a holiday event. Find its project first, then inspect the tasks and the people responsible.',
    remember: 'A project marked complete needs the actual agreed work finished, not just a good description.',
    questions: [
      q('Before creating another project for the same event, what should you do?', ['Check whether it already exists','Use an unrelated name','Mark the old project complete'], 0, 'Checking the portfolio avoids duplicate plans.'),
      q('What makes a project easier for the team to follow?', ['A goal, deadline and next actions','A title with no owner','Only a photo'], 0, 'Clear responsibility and milestones make the project actionable.'),
    ],
  },
  bar: {
    handsOn: 'bar-report',
    explanation: 'Bar handles cocktails, alcoholic drinks and mocktails. Kitchen prepares food. Café handles café drinks and café service. Open Bar to read reports, check handovers, and report a problem. Report a problem is available to Bar staff; a lead handles assignment and status changes. The report does not change POS stock or orders.',
    example: 'The mocktail blender stops working. In this fictional exercise, open Bar, choose Report a problem, select Equipment, explain where the blender is and tell the next shift not to use it until checked.',
    repeatVariant: { example: 'A fictional bottle of syrup is nearly empty at shift change. Record the low stock in Bar so the next bartender can check it.', questions: [
      q('Which department should get a mocktail stock report?', ['Bar','Kitchen','Housekeeping'], 0, 'Mocktails are handled by Bar.'),
      q('Does saving a Bar report change POS stock?', ['Yes, it updates the stock count','No, it is a handover/report only','It changes stock after the next shift reads it'], 1, 'Operations reports do not adjust POS inventory.'),
    ] },
    remember: 'Use made-up records only in the separate training app. Tell your lead immediately if a real fault is dangerous. Opening and closing steps come from the approved workplace routine, not from this lesson.',
    questions: [
      q('Where does a complaint about a cocktail belong?', ['Café','Bar','Kitchen'], 1, 'Bar handles alcoholic drinks and mocktails.'),
      q('A blender smells burnt. What is the next action?', ['Continue using it','Stop using it, tell the lead and report the fault','Mark it repaired'], 1, 'Do not keep using unsafe equipment; a qualified person should check it.'),
    ],
  },
  marketing: {
    explanation: 'Marketing posts move from an idea to a draft, review, changes and publication. Use Areas covered to choose Rooms, Pool, Café, Kitchen or Bar. Tick one area for a Pool-only offer, or several for a Café and Bar event. Use the area filter to find each promotion; older work may say Areas not set. A reviewed design is not automatically approved to publish.',
    example: 'For a fictional Pool-only offer, select Pool and find it with the Pool filter. For a Café and Bar drinks event, select both Café and Bar and check that it appears under either filter. If a poster has a spelling mistake, request a correction before approval.',
    remember: 'Do not publish a real poster while using the fictional training app.',
    questions: [
      q('A poster has a spelling mistake before approval. What should happen?', ['Request a correction','Send it for publication with a note','Leave it in review without telling the designer'], 0, 'The problem should be corrected before authorized publication.'),
      q('Does a post being in Review mean it is already published?', ['Yes, review publishes the post','No, it is awaiting a decision','Only when the draft has an image'], 1, 'Review and Posted are distinct stages.'),
    ],
  },
  'management-review': {
    explanation: 'A manager reviews the underlying evidence before approving, rejecting or asking for changes. A request that lacks proof should not be approved just to clear the queue.',
    example: 'A purchase request has no reliable price quotation. Ask for the missing information instead of guessing.',
    remember: 'Only the person allowed to approve a request can make that decision.',
    questions: [
      q('A request has missing evidence. What should the reviewer do?', ['Request clarification or supporting information','Approve without looking','Ignore the missing details'], 0, 'Authorized reviewers need adequate evidence.'),
      q('A request is approved. Does this prove the item was delivered?', ['No, delivery or implementation must be checked separately','Yes, because approval starts delivery','Only when the request included a quotation'], 0, 'The approval decision is not proof that the work was carried out.'),
    ],
  },
  accounts: {
    explanation: 'Each staff member should use their own account. Roles and department access determine what they can view and change. Never share a password to work around a permission limit.',
    example: 'A new fictional receptionist needs access only to the correct department and tasks; do not give unrestricted manager powers.',
    remember: 'Changing an employee’s access must be approved and follow the resort’s rules.',
    questions: [
      q('A staff member cannot open a manager-only screen. What should they do?', ['Ask an authorized manager or admin','Borrow a colleague’s password','Create a second hidden account'], 0, 'Permission limits must not be bypassed using another person’s login.'),
      q('What is the safest access for a new employee?', ['Only what the job actually requires','Full permissions everywhere','A shared password for the team'], 0, 'Individual accounts with limited necessary access protect records.'),
    ],
  },
};

export type CourseStage = 'learn' | 'quiz' | 'tour' | 'room-practice' | 'shift-practice' | 'work' | 'independent' | 'done' | 'finished';
export type CourseProgress = {
  lessonId: string;
  stage: CourseStage;
  question: number;
  independentStep?: number;
  /** Index of the last displayed actual-page tour step; never proof of completion. */
  tourStep?: number;
  reference?: string;
  passed: string[];
  metrics?: Record<string, { incorrectAnswers?: number; repeats?: number; completedAt?: string; hintsViewed?: number }>;
};

/** Adapt shared lessons to the work the employee actually does. */
export function courseGuideFor(id: string, department: string, isFrontDesk: boolean): CourseGuide | undefined {
  const base = COURSE_GUIDES[id];
  if (!base) return undefined;
  if (id === 'staff-rooms' && !isFrontDesk) return {
    ...base,
    explanation: 'Rooms lists guest rooms and shared areas. Find the right place and read the information available to your team. Some reports may be visible only to the team handling them.',
    example: 'You need to find Solace. Open its room details and see what your team can read. If you cannot see a report, ask the responsible team rather than assuming there is no problem.',
    questions: [q('You cannot see a report in a room. What should you do?', ['Ask the responsible team to check','Assume no problem exists','Use another employee’s account'], 0, 'A report may be available only to the team handling it.'), base.questions[1]],
  };
  if (id !== 'staff-handover') return base;
  const examples: Record<string, [string,string]> = {
    'housekeeping': ['A room still needs an inspection before the next arrival.', 'Housekeeping lead'],
    'café': ['A breakfast order is delayed and the guest is waiting for an update.', 'Café lead'],
    'kitchen': ['An allergy order is waiting for an ingredient check.', 'Kitchen lead'],
    'maintenance': ['A repair still needs an inspection before the area can be used.', 'Maintenance lead'],
    'marketing': ['A draft post has the wrong event date and needs a review.', 'Marketing lead'],
    'security': ['A pool gate has not yet been checked and guests must be kept away.', 'Security lead'],
  };
  const item = examples[department.toLowerCase()];
  if (!item) return base;
  const [situation, lead] = item;
  return { ...base, example: situation + ' The ' + lead + ' needs to know what is still waiting and what to check next.',
    incorrectExample: 'An employee tells the next shift the work is finished without checking.',
    branches: [{question: 'What if the check cannot be finished before your shift ends?', choices: ['Leave without an update', 'Tell the next shift what is waiting, who will check it and when', 'Say the work is finished'], correct: 1, response: 'The next shift needs the unfinished problem, the person responsible and the next check.'}],
    questions: [base.questions[0], q('The handover says a check is still pending. What should you do?', ['Assume it is done','Wait without telling anyone','Check the situation or tell the person responsible'],2,'Unfinished work needs a follow-up.')],
  };
}

/** Read data as untrusted browser state: it is a convenience resume marker,
 * not an official competency credential or proof of saved work.
 */
export function readCourseProgress(raw: string | null, lessons: readonly TrainingLesson[]): CourseProgress {
  const first = lessons[0]?.id || 'orientation';
  const fallback: CourseProgress = { lessonId: first, stage: 'learn', question: 0, passed: [] };
  if (!raw) return fallback;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fallback;
    const v = data as Record<string, unknown>;
    const allowed = new Set(lessons.map(lesson => lesson.id));
    const lessonId = typeof v.lessonId === 'string' && allowed.has(v.lessonId) ? v.lessonId : first;
    const stage = ['learn','quiz','tour','room-practice','shift-practice','work','independent','done','finished'].includes(String(v.stage)) ? v.stage as CourseStage : 'learn';
    const question = typeof v.question === 'number' && Number.isInteger(v.question) && v.question >= 0 && v.question <= 1 ? v.question : 0;
    const independentStep = v.independentStep === 1 ? 1 : 0;
    const rawTourStep = Number(v.tourStep);
    const maxTourStep = Math.max(0, (lessons.find(item => item.id === lessonId)?.steps.length || 1) - 1);
    const tourStep = v.tourStep !== undefined && Number.isSafeInteger(rawTourStep)
      ? Math.min(maxTourStep, Math.max(0, rawTourStep)) : 0;
    const passed = Array.isArray(v.passed) ? v.passed.filter((id): id is string => typeof id === 'string' && allowed.has(id)).slice(0, lessons.length) : [];
    const metrics: NonNullable<CourseProgress['metrics']> = {};
    if (v.metrics && typeof v.metrics === 'object' && !Array.isArray(v.metrics)) {
      for (const [id, val] of Object.entries(v.metrics as Record<string,unknown>).slice(0,50)) {
        if (!allowed.has(id) || !val || typeof val !== 'object' || Array.isArray(val)) continue;
        const m = val as Record<string,unknown>;
        metrics[id] = {
          incorrectAnswers: Math.max(0, Math.min(999, Math.floor(Number(m.incorrectAnswers)||0))),
          repeats: Math.max(0, Math.min(999, Math.floor(Number(m.repeats)||0))),
          hintsViewed: Math.max(0, Math.min(999, Math.floor(Number(m.hintsViewed)||0))),
          ...(typeof m.completedAt === 'string' && m.completedAt.length < 40 ? { completedAt:m.completedAt } : {}),
        };
      }
    }
    // Local storage is a resume convenience, not proof of competency. A forged or
    // interrupted "finished" marker must not bypass unfinished role-available lessons.
    if (stage === 'finished') {
      const missing = lessons.filter(lesson => !passed.includes(lesson.id));
      if (missing.length) {
        // A previously completed curriculum can acquire new role lessons
        // during installation. Keep prior credit and offer those lessons
        // explicitly rather than unexpectedly covering the entire app.
        // Any other missing legacy lesson still requires the normal course.
        const catchup = new Set<string>(TRAINING_CATCHUP_LESSONS);
        const priorCurriculumPassed = lessons.some(lesson =>
          lesson.id !== 'orientation' && !catchup.has(lesson.id) && passed.includes(lesson.id));
        if (passed.includes('orientation') && priorCurriculumPassed &&
            missing.every(lesson => catchup.has(lesson.id))) {
          return { lessonId: missing[0].id, stage: 'finished', question: 0,
            independentStep: 0, tourStep: 0, passed, metrics };
        }
        return {
          lessonId: missing[0].id, stage: 'learn', question: 0, independentStep: 0,
          passed, metrics,
        };
      }
    }
    // Keep the next unfinished lesson in sequence. Completed lessons may still be
    // opened for legitimate review; an incomplete later lesson is never unlocked.
    const nextUnfinished = lessons.find(lesson => !passed.includes(lesson.id));
    if (nextUnfinished && lessonId !== nextUnfinished.id && !passed.includes(lessonId)) return {
      lessonId: nextUnfinished.id, stage: 'learn', question: 0, independentStep: 0,
      passed, metrics,
    };
    if (stage === 'done' && !passed.includes(lessonId)) return {
      lessonId, stage: 'learn', question: 0, independentStep: 0, passed, metrics,
    };
    const reference = typeof v.reference === 'string' && /^TRN-(GUEST|TASK|SHIFT|FIX|REQ|LINK|BAR)-[A-Z0-9]{8,20}$/.test(v.reference) ? v.reference : undefined;
    return { lessonId, stage: stage === 'work' && !reference ? 'learn' : stage,
      question, independentStep, tourStep, ...(reference ? { reference } : {}), passed, metrics };
  } catch { return fallback; }
}
/** Lessons added after the previous completed curriculum. They are offered as
 * catch-up training, never silently awarded or used to lock returning workers
 * out of already completed routines during a desktop app upgrade. */
export const TRAINING_CATCHUP_LESSONS = ['room-arrivals', 'maintenance-status'] as const;
export const COURSE_STORAGE_PREFIX = 'ho-ops-structured-course-v2:';
