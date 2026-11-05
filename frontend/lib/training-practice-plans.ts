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
    checks: 'The app checks which pages you open.',
    safety: 'Do not mark a task finished just because you read a notification.',
  },
  'staff-handover': {
    goal: 'Read what the previous shift left unfinished.',
    show: 'Open Shift handover, choose Urgent, read the Night handover from your department, and check its status.',
    help: 'Find the highlighted handover. Read its saved status before answering.',
    self: 'Find your department’s PM handover without arrows and identify its saved status.',
    checks: 'The app checks your answers against the practice shift notes.',
    safety: 'Reading a handover does not complete or approve the work.',
  },
  'staff-rooms': {
    goal: 'Find a guest room and check whether a problem is already reported.',
    show: 'Open Rooms, choose Guest rooms, search Solace, and open its AC report.',
    help: 'Click the highlighted Rooms controls yourself and choose the report’s saved status.',
    self: 'Find Perch 1 and its towel request without arrows.',
    checks: 'The app checks the room and report you choose.',
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
  'room-arrivals': {
    goal: 'Read room plans and check the recorded guest status.',
    show: 'Open Room cleaning. Choose a date and read the Arrival or Departure label separately from Guest status.',
    help: 'Find the room name, then check what is planned and what Front Desk has recorded.',
    self: 'Find a room and refresh its latest update without arrows.',
    checks: 'This role checks room information and navigation. Front Desk staff also practise saving arrivals and departures.',
    safety: 'A planned departure does not confirm that a guest has left.',
  },
  'maintenance-status': {
    goal: 'Understand where a repair stands.',
    show: 'Open Maintenance and read the repair statuses.',
    help: 'Use the filters to find repairs and read their saved status.',
    self: 'Open a practice repair, read its status, then return to Active repairs without arrows.',
    checks: 'The app checks that you opened a repair and returned to Active; a trainer checks your understanding.',
    safety: 'Do not mark a repair verified unless the authorized check is complete.',
  },
  'team-tasks': {
    goal: 'Give a job to the right person and follow it until review.',
    show: 'Find the team task list, search for existing work, and open the New task form.',
    help: 'Enter a fictional job with the reference shown in the guide. Save it yourself.',
    self: 'Create and assign a practice task, start it, then submit it for review.',
    checks: 'The app checks your saved task and its status.',
    safety: 'Only leads and authorized managers may create or update these tasks.',
  },
  'guest-matters': {
    goal: 'Record a guest concern and arrange a follow-up.',
    show: 'Find open guest matters first. A guest in Solace says the AC is not cooling.',
    help: 'Use the highlighted guest form and a made-up guest name. Assign the correct team.',
    self: 'Create a practice guest matter, then save its follow-up action.',
    checks: 'The app checks the saved fictional record and its required steps.',
    safety: 'Do not report a repair as finished until someone has checked it.',
  },
  maintenance: {
    goal: 'Report a repair and check whether it is finished.',
    show: 'Open Maintenance and look for an existing Solace AC problem before entering another one.',
    help: 'Use Report issue to enter a fictional defect. Follow the guide to save work.',
    self: 'Start the practice repair, mark it done and ask for the final check.',
    checks: 'The app checks the saved repair. Only authorized managers can verify completed work.',
    safety: 'Done and Verified mean different things. Never bypass a safety check.',
  },
  requests: {
    goal: 'Submit a clear request for review.',
    show: 'Open Requests and read the statuses for Draft and Review.',
    help: 'Write exactly what the department needs, why, and who should review it.',
    self: 'Create a practice request, send it for review, and check its saved status.',
    checks: 'The app checks your saved request and whether it was sent for review.',
    safety: 'Wait for approval before arranging a purchase.',
  },
  'shift-writing': {
    goal: 'Leave a useful note for the next shift.',
    show: 'Find unresolved handovers and read what information is missing.',
    help: 'Write a fictional note with the problem, responsible person, and next check.',
    self: 'Save the handover and perform the required follow-up step yourself.',
    checks: 'The app checks your saved note and its status.',
    safety: 'A note does not prove the job was completed.',
  },
  projects: {
    goal: 'Plan a team project without losing its separate tasks.',
    show: 'Open Projects and review the current status of a practice project.',
    help: 'Create a fictional project with its target, owner, and date.',
    self: 'Find Active projects, then switch back to All without arrows.',
    checks: 'This lesson checks project navigation. A trainer needs to review your planning skills.',
    safety: 'Project planning does not authorize spending.',
  },
  marketing: {
    goal: 'Review a post without publishing it by mistake.',
    show: 'Open Marketing, read a draft post, and identify what needs changes.',
    help: 'Use the actual content controls to review a fictional design.',
    self: 'Return to the dashboard without publishing anything.',
    checks: 'Your trainer reviews how you check the design.',
    safety: 'Do not publish or post anything as part of this exercise.',
  },
  'management-review': {
    goal: 'Review work before giving approval.',
    show: 'Open Review, find a pending decision, and read its supporting details.',
    help: 'Compare what the request says with the evidence available.',
    self: 'Find a decision, then return without approving a real record.',
    checks: 'Your trainer needs to watch how you make approval decisions.',
    safety: 'Do not approve a task or purchase without the required evidence.',
  },
  accounts: {
    goal: 'Find an employee and protect their access.',
    show: 'Search the Users screen before changing any account.',
    help: 'Read roles and department access without editing them.',
    self: 'Find an account using a fictional search term and return safely.',
    checks: 'This practice checks how you find an account.',
    safety: 'Never share passwords or grant manager permissions as practice.',
  },
};
