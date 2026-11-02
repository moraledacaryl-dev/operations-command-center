export type TrainingRequirement = 'manage_department' | 'make_decisions' | 'manage_accounts';
export type TrainingStep = {
  title: string;
  body: string;
  path: string;
  selector: string;
  targetText?: string;
  /** Only safe, reversible clicks (opening a form, switching a tab). */
  advanceOnClick?: boolean;
  /** The trainee must click this real navigation control before the lesson advances. */
  requiresAction?: boolean;
};
export type TrainingLesson = {
  id: string;
  title: string;
  summary: string;
  requirement?: TrainingRequirement;
  marketingOnly?: boolean;
  steps: readonly TrainingStep[];
};

/**
 * Read-only assistance attached to actual Operations controls.
 * No lesson ever clicks a Save, Submit, Approve, Verify, or Publish action for the user.
 * Changing business records requires a separate isolated demo environment.
 */
export const TRAINING_LESSONS: readonly TrainingLesson[] = [
  {
    id: 'orientation', title: 'Getting around Operations', summary: 'Find your tasks, messages and the Today page.',
    steps: [
      { path: '/', selector: '.ops-breadcrumb', title: 'You are on the practice dashboard', body: "This practice app uses the same screens as Operations. The names and records are made up. Choose Next to begin." },
      { path: '/', selector: 'a[aria-label="My Work"]', title: 'Find My Work', body: "Choose My Work in the side menu. On a phone, open the menu first. This shows the tasks assigned to your account.", advanceOnClick: true, requiresAction: true },
      { path: '/my-work', selector: '.ops-agenda, .ops-module', title: 'Review your assigned work', body: "Read the overdue tasks and those due today. Open a task to read its instructions, then close the details and choose Next." },
      { path: '/my-work', selector: 'a.ops-notifications', title: 'Find notifications', body: "Choose the bell at the top of the screen to open Notifications.", advanceOnClick: true, requiresAction: true },
      { path: '/notifications', selector: '.ops-module, main', title: 'Read your notifications', body: "Read each message and open any linked task. Mark read means you have read the message; it does not finish the work." },
      { path: '/notifications', selector: 'a.ops-brand[href="/"]', title: 'Return to the dashboard', body: "Choose the Hidden Oasis logo to return to Today.", advanceOnClick: true, requiresAction: true },
      { path: '/', selector: '.today-workspace', title: 'You know your way around', body: "You have found your tasks, checked your messages and returned to Today. Choose Training whenever you want to repeat a lesson." },
    ],
  },
  {
    id: 'staff-handover', title: 'Reading a shift handover', summary: 'Understand what the previous shift left for you.',
    steps: [
      { path: '/shift', selector: '[aria-label="Shift note filters"] button', targetText: 'Urgent', title: 'Find outstanding handovers', advanceOnClick: true, requiresAction: true, body: "Choose Urgent to see notes that need attention soon. Unresolved shows work that is still unfinished." },
      { path: '/shift', selector: '.ops-handover-card, .ops-module', title: 'Read the full note', body: "Open a handover note. Read what happened, who is handling it and what your shift needs to do. Reading the note does not finish the work." },
      { path: '/shift', selector: '.ops-module', title: 'Escalate what you cannot finish', body: "If you cannot finish the work or do not have the button you need, tell your lead. Use your own login." },
    ],
  },
  {
    id: 'staff-rooms', title: 'Rooms and guest information', summary: 'Find Solace and read its saved report before starting new work.',
    steps: [
      { path: '/rooms', selector: '[aria-label="Space type"] button', targetText: 'Guest rooms', title: 'Filter spaces', advanceOnClick: true, requiresAction: true, body: "Choose Guest rooms to see bedrooms. Choose Shared areas to see places such as the pool or café." },
      { path: '/rooms', selector: '[aria-label="Search rooms and areas"]', title: 'Search for a specific room', body: "Type a room name such as Solace, then choose Next. You will open the room in the next step." },
      { path: '/rooms', selector: '.room-memory-columns, .space-card, .ops-module', title: 'Review before escalating', body: "Open the room card. Read Guest matters and Maintenance. Check for the same problem before asking someone to create another report." },
    ],
  },
  {
    id: 'staff-my-work', title: 'Understanding assigned tasks', summary: 'Priorities, deadlines, and task details for everyday staff.',
    steps: [
      { path: '/my-work', selector: '.ops-agenda-overdue, .ops-agenda', title: 'Overdue work', body: "These tasks are past their due date. Read the instructions and tell your lead if you cannot meet the deadline." },
      { path: '/my-work', selector: '.ops-agenda-today, .ops-agenda', title: 'Today\'s assignments', body: "Read the tasks due today and plan them into your shift. Open each task to see what needs doing." },
      { path: '/my-work', selector: '.ops-agenda-waiting, .ops-agenda', title: 'Waiting or review', body: "Waiting means something is still needed. Review means someone needs to check the work. Neither means the task is finished." },
      { path: '/my-work', selector: 'a.ops-brand[href="/"]', title: 'Return to your dashboard', body: "Choose the Hidden Oasis logo to return to Today and finish this practice.", advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'team-tasks', title: 'Creating and managing a task', summary: 'For Leads, Supervisors, and Management.',
    requirement: 'manage_department',
    steps: [
      { path: '/tasks', selector: '[aria-label="Task view"]', title: 'Board versus List', body: "Board puts tasks into columns by status. List shows them in rows with their due dates and priorities." },
      { path: '/tasks', selector: '[placeholder="Search team tasks"]', title: 'Search before creating', body: "Search for the job first. Use the existing task if the same job is already listed." },
      { path: '/tasks', selector: '[data-testid="create-task"]', title: 'Open New task', body: "Choose New task to open the form. Nothing is saved until you choose Create task.", advanceOnClick: true, requiresAction: true },
      { path: '/tasks', selector: '[data-testid="create-task-form"] .form-grid', title: 'Fill out the task', body: "Enter the job, due date, priority and person responsible. Example: Follow up the Perch 2 guest request. Choose someone from your department. For this tour, leave the form unsaved." },
      { path: '/tasks', selector: '[data-testid="create-task-form"] .toolbar button.secondary', title: 'Close without saving', body: "Choose Cancel to close this example. Later, the saved-work exercise will ask you to create a practice task.", advanceOnClick: true },
    ],
  },
  {
    id: 'guest-matters', title: 'Recording a guest matter', summary: 'Complaints, service recovery, and follow-ups.',
    requirement: 'manage_department',
    steps: [
      { path: '/guests', selector: '[aria-label="Guest matter filters"]', title: 'Check for an existing concern', body: "Use Active and Urgent to find open guest problems. Check whether the same concern is already listed." },
      { path: '/guests', selector: '[data-testid="create-guest"]', title: 'Open New guest matter', body: "Choose New guest matter to open the form. This does not save anything yet.", advanceOnClick: true, requiresAction: true },
      { path: '/guests', selector: '[data-testid="create-guest-form"]', title: 'What to record', body: "Write what happened, the room, how urgent it is, who should help and when to call the guest back. Example: Solace AC is warm; ask Maintenance to inspect it and Reception to call the guest by 10 AM." },
      { path: '/guests', selector: '[data-testid="create-guest-form"] button.secondary', title: 'Close the example', body: "Choose Cancel to close the example. The saved-work exercise will guide you through saving a practice guest matter.", advanceOnClick: true },
    ],
  },
  {
    id: 'maintenance', title: 'Reporting and checking repairs', summary: 'Follow work from Open to Verified.',
    requirement: 'manage_department',
    steps: [
      { path: '/fixes', selector: '[aria-label="Maintenance filters"]', title: 'Identify existing work', body: "Check Active and Urgent for repairs that still need attention. Done means the repair still needs to be checked." },
      { path: '/fixes', selector: '[data-testid="create-fix"]', title: 'Open Report issue', body: "Choose Report issue to open the repair form.", advanceOnClick: true, requiresAction: true },
      { path: '/fixes', selector: '[data-testid="create-fix-form"]', title: 'Describe the defect clearly', body: "Name the problem, room or area, urgency and person who should repair it. Example: The AC in Solace blows warm air. Leave this example unsaved." },
      { path: '/fixes', selector: '[data-testid="create-fix-form"] button.secondary', title: 'Cancel this training entry', body: "Choose Cancel. A manager must check a finished repair before marking it Verified.", advanceOnClick: true },
      { path: '/fixes', selector: '[aria-label="Maintenance work orders"]', title: 'Understand the maintenance lanes', body: "Repairs move through Open → Working → Done → Verified. Done means the technician says the repair is finished. Verified means a manager has checked it." },
    ],
  },
  {
    id: 'requests', title: 'Writing a request', summary: 'Write a request and learn what its status means.',
    requirement: 'manage_department',
    steps: [
      { path: '/requests', selector: '[aria-label="Request status"]', title: 'Check the request queue', body: "Use the status filters to find drafts, requests waiting for review and decisions already made." },
      { path: '/requests', selector: '[data-testid="create-request"]', title: 'Open New request', body: "Choose New request to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/requests', selector: '[data-testid="create-request-form"] .form-grid', title: 'Write the reason', body: "Explain what you need, why you need it and how urgent it is. Official requests to buy from suppliers still go through Accounting." },
      { path: '/requests', selector: '[data-testid="create-request-form"] .toolbar button.secondary', title: 'Close the sample request', body: "Choose Cancel. The saved-work exercise will ask you to save and submit a practice request.", advanceOnClick: true },
    ],
  },
  {
    id: 'shift-writing', title: 'Writing a shift note', summary: 'Tell the next shift what still needs doing.',
    requirement: 'manage_department',
    steps: [
      { path: '/shift', selector: '[aria-label="Shift note filters"]', title: 'Review the unresolved notes', body: "Read the unfinished notes before writing a new handover." },
      { path: '/shift', selector: '[data-testid="create-shift"]', title: 'Open New handover', body: "Choose New handover to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/shift', selector: '[data-testid="create-shift-form"] .form-grid', title: 'Give the next shift enough context', body: "Write the problem, shift, urgency, person responsible and next check. Example: Solace AC is warm; Maintenance will inspect it; Reception will call the guest by 10 AM." },
      { path: '/shift', selector: '[data-testid="create-shift-form"] .toolbar button.secondary', title: 'Close the practice entry', body: "Choose Cancel. You will save a practice handover in the next exercise.", advanceOnClick: true },
    ],
  },
  {
    id: 'projects', title: 'Planning a project with your team', summary: 'From project portfolio to planning tasks.',
    requirement: 'manage_department',
    steps: [
      { path: '/projects', selector: '[aria-label="Project status"]', title: 'Choose a project stage', body: "A project is a larger job with several tasks. Check the existing projects before adding one for the same work." },
      { path: '/projects', selector: '[data-testid="create-project"]', title: 'Open a project form', body: "Choose New project to enter its name, due date, priority and notes.", advanceOnClick: true, requiresAction: true },
      { path: '/projects', selector: '[data-testid="create-project-form"] .form-grid', title: 'Define a good project', body: "Example: Prepare the Halloween event. State what needs to be ready, when it is due, which team is responsible and what happens next. Leave this example unsaved." },
      { path: '/projects', selector: '[data-testid="create-project-form"] .toolbar button.secondary', title: 'Discard the fictional project', body: "Choose Cancel to return to the project list. You can open a project to read its tasks, team discussion and purchase suggestions.", advanceOnClick: true },
    ],
  },
  {
    id: 'marketing', title: 'Preparing a marketing post', summary: 'Review content without accidentally publishing.',
    requirement: 'manage_department', marketingOnly: true,
    steps: [
      { path: '/posts', selector: '[aria-label="Marketing status"]', title: 'Find content awaiting work', body: "Use the status filters to find posts that need work or a decision. Posted means a post has been published." },
      { path: '/posts', selector: '.ops-content-heading, .ops-module', title: 'Understand creative review', body: "A post in Review needs a decision. A post in Fix needs changes before it can be approved." },
      { path: '/posts/editor', selector: '.ops-module, main', title: 'Annotation Studio', body: "Open a design and add arrows, text or highlights to show what needs changing. Saving creates a new version." },
      { path: '/posts/editor', selector: 'a.ops-brand[href="/"]', title: 'Return after reviewing', body: "Choose the Hidden Oasis logo to return to Today. You do not need to publish anything in this lesson.", advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'management-review', title: 'Review and approval decisions', summary: 'For authorized Managers and Administrators.',
    requirement: 'make_decisions',
    steps: [
      { path: '/review', selector: '[placeholder="Search decisions"]', title: 'Find a decision', body: "Search for the request or problem. Open it and read the details before making a decision." },
      { path: '/review', selector: '.queue-heading, .ops-module', title: 'Choose a correct outcome', body: "Check the work and supporting details before approving it. If something is wrong or missing, explain what needs to change." },
      { path: '/approvals', selector: '[aria-label="Approval status"]', title: 'Understand the approval queue', body: "Pending means a decision is still needed. Approved means permission was given; the purchase or work may still be unfinished." },
      { path: '/approvals', selector: 'a.ops-brand[href="/"]', title: 'Return without deciding', body: "Choose the Hidden Oasis logo to return to Today. You do not need to approve anything in this lesson.", advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'accounts', title: 'People and access', summary: 'Learn who can use each part of the app.',
    requirement: 'manage_accounts',
    steps: [
      { path: '/admin/users', selector: '[placeholder="Search name, email, or role"]', title: 'Find a real account first', body: "Search for the person before adding an account or resetting a password. Each employee needs their own login." },
      { path: '/admin/users', selector: '.ops-module, main', title: 'Assign minimum access', body: "Give each employee only the access their job needs. Staff read their work; leads manage department work; managers make decisions." },
      { path: '/admin/users', selector: '.ops-module, main', title: 'Passwords and department access', body: "Give each employee their own temporary password and the departments they need. Changing access may sign them out." },
      { path: '/admin/users', selector: 'a.ops-brand[href="/"]', title: 'Return without modifying an account', body: "Choose the Hidden Oasis logo to finish. Leave accounts and permissions unchanged during this lesson.", advanceOnClick: true, requiresAction: true },
    ],
  },
];

export function availableTrainingLessons(
  capabilities: Record<string, boolean>,
  departments: { name?: string }[] = [],
): TrainingLesson[] {
  const marketing = Boolean(capabilities.view_all_operations)
    || departments.some(d => String(d.name || '').toLowerCase().includes('marketing'));
  return TRAINING_LESSONS.filter(lesson =>
    (!lesson.requirement || capabilities[lesson.requirement] === true)
    && (!lesson.marketingOnly || marketing)
  );
}
