/** One practical goal per Operations lesson. The same Show → Guided → Your turn
 * structure is used by all departments while backend permissions remain intact.
 * Examples are fictional and safe. They are never substitutes for saved-work proof.
 */
export type PracticePlan = {
  goal: string;
  show: string;
  help: string;
  self: string;
  checks: string;
  safety: string;
};

export const PRACTICE_PLANS: Record<string, PracticePlan> = {
  orientation: {
    goal: 'Find your assigned work and new messages.',
    show: 'From Today, open My Work. Read one assignment, open the notification bell, then return using the Hidden Oasis logo.',
    help: 'Follow the arrow to the menu or button shown in each step. Click links yourself.',
    self: 'Find My Work and your notifications without an arrow.',
    checks: 'The app checks the actual navigation controls you use.',
    safety: 'Do not mark a task finished just because you read a notification.',
  },
  'staff-handover': {
    goal: 'Read what the previous shift left unfinished.',
    show: 'Open Shift handover, choose Urgent, read the Night handover from your department, and check its status.',
    help: 'Find the highlighted handover. Read its saved status before answering.',
    self: 'Find your department’s PM handover without arrows and identify its saved status.',
    checks: 'Staff answers are compared with the actual fictional handovers saved on this computer.',
    safety: 'Reading a handover does not complete or approve the work.',
  },
  'staff-rooms': {
    goal: 'Find a guest room and check whether a problem is already reported.',
    show: 'Open Rooms, choose Guest rooms, search Solace, and open its AC report.',
    help: 'Click the highlighted Rooms controls yourself and choose the report’s saved status.',
    self: 'Find Perch 1 and its towel request without arrows.',
    checks: 'The app checks the selected room and saved fictional report.',
    safety: 'Do not create a duplicate report or assume a problem is fixed.',
  },
  'staff-my-work': {
    goal: 'Read your tasks and find what needs attention first.',
    show: 'In My Work, check overdue and due-today items, then read the status of work waiting for review.',
    help: 'Look at the area highlighted on each step before moving to the next.',
    self: 'Return to Today, then open My Work using the actual menu.',
    checks: 'The app checks navigation actions; a trainer should observe how you prioritize real work.',
    safety: 'Do not change work status or use someone else’s account.',
  },
  'team-tasks': {
    goal: 'Give a job to the right person and follow it until review.',
    show: 'Find the team task list, search for existing work, and open the New task form.',
    help: 'Enter a fictional job with the reference shown in the guide. Save it yourself.',
    self: 'Start the saved task and submit it for review on the real practice screen.',
    checks: 'The training database verifies the task and its saved status.',
    safety: 'Only leads and authorized managers may create or update these tasks.',
  },
  'guest-matters': {
    goal: 'Record a guest concern and arrange a follow-up.',
    show: 'Find open guest matters first. A guest in Solace says the AC is not cooling.',
    help: 'Use the highlighted guest form and a made-up guest name. Assign the correct team.',
    self: 'Review the saved guest matter and complete the required follow-up action.',
    checks: 'The app checks the saved fictional record and its required steps.',
    safety: 'Do not report a repair as finished until someone has checked it.',
  },
  maintenance: {
    goal: 'Report a repair and check whether it is finished.',
    show: 'Open Maintenance and look for an existing Solace AC problem before entering another one.',
    help: 'Use Report issue to enter a fictional defect. Follow the guide to save work.',
    self: 'Progress the training repair through its permitted statuses.',
    checks: 'The app checks the saved repair. Only authorized managers can verify completed work.',
    safety: 'Done and Verified mean different things. Never bypass a safety check.',
  },
  requests: {
    goal: 'Submit a clear request for review.',
    show: 'Open Requests and read the statuses for Draft and Review.',
    help: 'Write exactly what the department needs, why, and who should review it.',
    self: 'Submit the practice request and check that the Review status is saved.',
    checks: 'The training database verifies the actual request and approval workflow.',
    safety: 'A request is not a purchase order; real purchasing remains in Accounting.',
  },
  'shift-writing': {
    goal: 'Leave a useful note for the next shift.',
    show: 'Find unresolved handovers and read what information is missing.',
    help: 'Write a fictional note with the problem, responsible person, and next check.',
    self: 'Save the handover and perform the required follow-up step yourself.',
    checks: 'The app verifies the saved note and its workflow status.',
    safety: 'A note does not prove the job was completed.',
  },
  projects: {
    goal: 'Plan a team project without losing its separate tasks.',
    show: 'Open Projects and review the current status of a practice project.',
    help: 'Create a fictional project with its target, owner, and date.',
    self: 'Use the saved project to review the next planning action.',
    checks: 'The app checks what is saved in the isolated practice database.',
    safety: 'Project planning does not authorize spending.',
  },
  marketing: {
    goal: 'Review a post without publishing it by mistake.',
    show: 'Open Marketing, read a draft post, and identify what needs changes.',
    help: 'Use the actual content controls to review a fictional design.',
    self: 'Return to the dashboard without publishing anything.',
    checks: 'The app checks the actions you took; a trainer reviews creative judgment.',
    safety: 'Do not publish or post anything as part of this exercise.',
  },
  'management-review': {
    goal: 'Review work before giving approval.',
    show: 'Open Review, find a pending decision, and read its supporting details.',
    help: 'Compare what the request says with the evidence available.',
    self: 'Find a decision, then return without approving a real record.',
    checks: 'This lesson checks safe navigation. Actual approval decisions need trainer observation.',
    safety: 'Do not approve a task or purchase without the required evidence.',
  },
  accounts: {
    goal: 'Find an employee and protect their access.',
    show: 'Search the Users screen before changing any account.',
    help: 'Read roles and department access without editing them.',
    self: 'Find an account using a fictional search term and return safely.',
    checks: 'The practice checks navigation only; no real credentials are changed.',
    safety: 'Never share passwords or grant manager permissions as practice.',
  },
};
