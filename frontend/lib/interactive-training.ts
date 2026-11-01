export type TrainingRequirement = 'manage_department' | 'make_decisions' | 'manage_accounts';
export type TrainingStep = {
  title: string;
  body: string;
  path: string;
  selector: string;
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
    id: 'orientation', title: 'Getting around Operations', summary: 'Navigate the actual workspace by clicking its controls.',
    steps: [
      { path: '/', selector: '.ops-breadcrumb', title: 'You are on the real training dashboard', body: 'This looks and works like Operations, but all accounts and records are fictional. We will navigate the actual pages together. Click Next to start.' },
      { path: '/', selector: 'a[aria-label="My Work"]', title: 'Find My Work in the actual navigation', body: 'Click the highlighted My Work link in the sidebar or bottom navigation. The tour will continue when you click it, just like during a shift.', advanceOnClick: true, requiresAction: true },
      { path: '/my-work', selector: '.ops-agenda, .ops-module', title: 'Review your assigned work', body: 'This is the real My Work screen. Look for overdue and today\'s items, then open a fictional task to read the details. Click Next when you understand.' },
      { path: '/my-work', selector: 'a.ops-notifications', title: 'Find notifications', body: 'Click the highlighted bell in the top bar to go to your actual Notifications screen.', advanceOnClick: true, requiresAction: true },
      { path: '/notifications', selector: '.ops-module, main', title: 'Read your notifications', body: 'Here you review updates and follow them to their related records. Do not mark a notification read until you understand what action is needed.' },
      { path: '/notifications', selector: 'a.ops-brand[href="/"]', title: 'Return to the dashboard', body: 'Click the Hidden Oasis logo to navigate home. That is how you return to the main dashboard during real work.', advanceOnClick: true, requiresAction: true },
      { path: '/', selector: '.today-workspace', title: 'You know your way around', body: 'You returned to Today using real navigation. To repeat this lesson or learn another screen, select the floating Training button. All records in this practice app remain fictional.' },
    ],
  },
  {
    id: 'staff-handover', title: 'Reading a shift handover', summary: 'Understand what the previous shift left for you.',
    steps: [
      { path: '/shift', selector: '[aria-label="Shift note filters"] button', title: 'Find outstanding handovers', advanceOnClick: true, requiresAction: true, body: 'Choose Unresolved or Urgent to focus on notes needing action. Completed records may be in History.' },
      { path: '/shift', selector: '.ops-handover-card, .ops-module', title: 'Read the full note', body: 'Open a handover card and check its category, shift, priority, and exact instructions. Do not assume a note is resolved just because it has been read.' },
      { path: '/shift', selector: '.ops-module', title: 'Escalate what you cannot finish', body: 'If your account does not have a follow-up or resolve button, inform your Supervisor. Never use someone else\'s login to close work.' },
    ],
  },
  {
    id: 'staff-rooms', title: 'Rooms and guest information', summary: 'Find rooms, spaces, and related operational issues.',
    steps: [
      { path: '/rooms', selector: '[aria-label="Space type"] button', title: 'Filter spaces', advanceOnClick: true, requiresAction: true, body: 'Select Guest rooms or Shared areas to narrow the list.' },
      { path: '/rooms', selector: '[aria-label="Search rooms and areas"]', title: 'Search for a specific room', body: 'Enter a room or area name. Open a matching card to review its operational history and linked matters.' },
      { path: '/rooms', selector: '.space-card, .ops-module', title: 'Review before escalating', body: 'Use the room page to find existing maintenance or guest issues before reporting a suspected duplicate.' },
    ],
  },
  {
    id: 'staff-my-work', title: 'Understanding assigned tasks', summary: 'Priorities, deadlines, and task details for everyday staff.',
    steps: [
      { path: '/my-work', selector: '.ops-agenda-overdue, .ops-agenda', title: 'Overdue work', body: 'Start with overdue work. Read the due date and priority, then tell your lead if a deadline cannot be met.' },
      { path: '/my-work', selector: '.ops-agenda-today, .ops-agenda', title: 'Today\'s assignments', body: 'These are the tasks to plan around during your shift. Open the cards to read the full scope.' },
      { path: '/my-work', selector: '.ops-agenda-waiting, .ops-agenda', title: 'Waiting or review', body: 'Work in Review or Waiting is not necessarily completed. Check whether a Supervisor needs to make the final decision.' },
      { path: '/my-work', selector: 'a.ops-brand[href="/"]', title: 'Return to your dashboard', body: 'You have read your assignment groups. Click the actual Hidden Oasis logo to go back to the main page and finish this practice.', advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'team-tasks', title: 'Creating and managing a task', summary: 'For Leads, Supervisors, and Management.',
    requirement: 'manage_department',
    steps: [
      { path: '/tasks', selector: '[aria-label="Task view"]', title: 'Board versus List', body: 'Board groups tasks by status. List is a compact way to scan titles, due dates, and priorities.' },
      { path: '/tasks', selector: '[placeholder="Search team tasks"]', title: 'Search before creating', body: 'Check for an existing task first to avoid duplicates.' },
      { path: '/tasks', selector: '[data-testid="create-task"]', title: 'Open New task', body: 'Select New task to see the entry form. Opening the form does not create a record.', advanceOnClick: true, requiresAction: true },
      { path: '/tasks', selector: '[data-testid="create-task-form"] .form-grid', title: 'Fill out the task', body: 'Try a specific title, a real due date, the correct urgency, and the appropriate assignee. EXAMPLE: Inspect Room 203 after checkout, assigned to the Housekeeping lead. Do not submit a live practice entry.' },
      { path: '/tasks', selector: '[data-testid="create-task-form"] .toolbar button.secondary', title: 'Close without saving', body: 'Choose Cancel to discard this training example. The interactive tutorial never presses Create task for you.', advanceOnClick: true },
    ],
  },
  {
    id: 'guest-matters', title: 'Recording a guest matter', summary: 'Complaints, service recovery, and follow-ups.',
    requirement: 'manage_department',
    steps: [
      { path: '/guests', selector: '[aria-label="Guest matter filters"]', title: 'Check for an existing concern', body: 'Filter Active and Urgent first. Search the actual record manually before logging another complaint.' },
      { path: '/guests', selector: '[data-testid="create-guest"]', title: 'Open New guest matter', body: 'Choose New guest matter to inspect the form. This step is safe because it does not save a record.', advanceOnClick: true, requiresAction: true },
      { path: '/guests', selector: '[data-testid="create-guest-form"]', title: 'What to record', body: 'Record the issue, guest or reference name, room, type, urgency, follow-up time, and the recovery action. EXAMPLE: Room 205 AC not cooling; follow up with Maintenance. Do not save fictional details in production.' },
      { path: '/guests', selector: '[data-testid="create-guest-form"] button.secondary', title: 'Close the example', body: 'Select Cancel. In the isolated training demo, you can instead practise saving a real fictional guest matter.', advanceOnClick: true },
    ],
  },
  {
    id: 'maintenance', title: 'Reporting and verifying maintenance', summary: 'Follow work from Open to Verified.',
    requirement: 'manage_department',
    steps: [
      { path: '/fixes', selector: '[aria-label="Maintenance filters"]', title: 'Identify existing work', body: 'Check Active and Urgent first. Work already marked Done may still require verification.' },
      { path: '/fixes', selector: '[data-testid="create-fix"]', title: 'Open Report issue', body: 'Use Report issue to open a new work order form.', advanceOnClick: true, requiresAction: true },
      { path: '/fixes', selector: '[data-testid="create-fix-form"]', title: 'Describe the defect clearly', body: 'Specify work item, exact room or area, urgency, technician, and scope. EXAMPLE: Room 205 air-conditioning weak cooling. Do not submit fictional training records to production.' },
      { path: '/fixes', selector: '[data-testid="create-fix-form"] button.secondary', title: 'Cancel this training entry', body: 'Close the example without saving. Actual repair verification is a Management decision and requires a verification note.', advanceOnClick: true },
      { path: '/fixes', selector: '[aria-label="Maintenance work orders"]', title: 'Understand the maintenance lanes', body: 'The workflow progresses Open → Working → Done → Verified. Done means the technician claims completion; Verified means authorized Management has checked it.' },
    ],
  },
  {
    id: 'requests', title: 'Operational request approval', summary: 'From draft proposal to implemented change.',
    requirement: 'manage_department',
    steps: [
      { path: '/requests', selector: '[aria-label="Request status"]', title: 'Check the request queue', body: 'Use Open, Draft, Review, Approved, Planned, Done, and Rejected to see each stage.' },
      { path: '/requests', selector: '[data-testid="create-request"]', title: 'Open New request', body: 'Choose New request to draft an operational proposal.', advanceOnClick: true, requiresAction: true },
      { path: '/requests', selector: '[data-testid="create-request-form"] .form-grid', title: 'Write the reason', body: 'Give the request a useful name, type, priority, and a concrete business reason. Official supplier purchase requests must still go through Accounting.' },
      { path: '/requests', selector: '[data-testid="create-request-form"] .toolbar button.secondary', title: 'Close the sample request', body: 'Cancel without saving. In the separate demo you can create, submit, approve, and implement a complete fictional request.', advanceOnClick: true },
    ],
  },
  {
    id: 'shift-writing', title: 'Writing a proper shift note', summary: 'Create a clear, actionable handover.',
    requirement: 'manage_department',
    steps: [
      { path: '/shift', selector: '[aria-label="Shift note filters"]', title: 'Review the unresolved notes', body: 'Read what is outstanding before publishing a new handover.' },
      { path: '/shift', selector: '[data-testid="create-shift"]', title: 'Open New handover', body: 'Select New handover to see the shift note form.', advanceOnClick: true, requiresAction: true },
      { path: '/shift', selector: '[data-testid="create-shift-form"] .form-grid', title: 'Give the next shift enough context', body: 'Add title, AM/PM/Night, category, urgency, and the detailed action needed. EXAMPLE: Room 205 cooling complaint; maintenance assigned; call guest by 10 AM.' },
      { path: '/shift', selector: '[data-testid="create-shift-form"] .toolbar button.secondary', title: 'Close the practice entry', body: 'Cancel rather than publishing fictional information to live operations.', advanceOnClick: true },
    ],
  },
  {
    id: 'projects', title: 'Projects and team collaboration', summary: 'From project portfolio to planning tasks.',
    requirement: 'manage_department',
    steps: [
      { path: '/projects', selector: '[aria-label="Project status"]', title: 'Choose a project stage', body: 'The portfolio shows planned, active, paused, and completed projects. Check existing projects before creating one.' },
      { path: '/projects', selector: '[data-testid="create-project"]', title: 'Open a project form', body: 'Select New project to see title, due date, priority, and notes.', advanceOnClick: true, requiresAction: true },
      { path: '/projects', selector: '[data-testid="create-project-form"] .form-grid', title: 'Define a good project', body: 'Example: Halloween activity preparation. State the outcome, deadline, responsible department, and next action. Do not save training entries in production.' },
      { path: '/projects', selector: '[data-testid="create-project-form"] .toolbar button.secondary', title: 'Discard the fictional project', body: 'Cancel to return to the portfolio. Training instances can be used for collaborative discussion and purchase suggestions.', advanceOnClick: true },
    ],
  },
  {
    id: 'marketing', title: 'Marketing creative workflow', summary: 'Review content without accidentally publishing.',
    requirement: 'manage_department', marketingOnly: true,
    steps: [
      { path: '/posts', selector: '[aria-label="Marketing status"]', title: 'Find content awaiting work', body: 'Filter Idea, Draft, Review, Fix, OK, Set, and Posted to see what needs attention.' },
      { path: '/posts', selector: '.ops-content-heading, .ops-module', title: 'Understand creative review', body: 'A creative in Review needs a decision. A creative in Fix must be revised before it can be approved again.' },
      { path: '/posts/editor', selector: '.ops-module, main', title: 'Annotation Studio', body: 'Open a creative and use arrows, text, highlights, or shapes for feedback. Saving makes a new version; do not alter real creative assets just for practice.' },
      { path: '/posts/editor', selector: 'a.ops-brand[href="/"]', title: 'Return after reviewing', body: 'Click the real Hidden Oasis logo to return to the dashboard. This finishes the read-only marketing tour.', advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'management-review', title: 'Review and approval decisions', summary: 'For authorized Managers and Administrators.',
    requirement: 'make_decisions',
    steps: [
      { path: '/review', selector: '[placeholder="Search decisions"]', title: 'Find a decision', body: 'Search by request or issue; filter to the appropriate decision source. Always read the underlying record first.' },
      { path: '/review', selector: '.queue-heading, .ops-module', title: 'Choose a correct outcome', body: 'Only approve or verify work when evidence supports it. When rejecting or requesting changes, record a useful reason.' },
      { path: '/approvals', selector: '[aria-label="Approval status"]', title: 'Understand the approval queue', body: 'Pending is waiting for a decision. Approved and Rejected record the outcome; neither should be used as a shortcut for completing implementation.' },
      { path: '/approvals', selector: 'a.ops-brand[href="/"]', title: 'Return without deciding', body: 'Click the Hidden Oasis logo to go home. You have inspected a real queue without making an unapproved decision.', advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'accounts', title: 'People and access administration', summary: 'Account creation, roles, and department membership.',
    requirement: 'manage_accounts',
    steps: [
      { path: '/admin/users', selector: '[placeholder="Search name, email, or role"]', title: 'Find a real account first', body: 'Search before creating or resetting an account. Never share one login between staff members.' },
      { path: '/admin/users', selector: '.ops-module, main', title: 'Assign minimum access', body: 'Staff can read assigned information. Leads and Supervisors can manage department work. Manager and Administrator privileges are sensitive.' },
      { path: '/admin/users', selector: '.ops-module, main', title: 'Passwords and department access', body: 'Use an individual temporary password and give only the departments needed. Role or active-state changes can revoke sessions.' },
      { path: '/admin/users', selector: 'a.ops-brand[href="/"]', title: 'Return without modifying an account', body: 'Click the Hidden Oasis logo to finish the read-only practice. Never change a practice user’s privileges unless a lesson explicitly asks you to.', advanceOnClick: true, requiresAction: true },
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
