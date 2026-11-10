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
  barOnly?: boolean;
  steps: readonly TrainingStep[];
};

/**
 * Read-only assistance attached to actual Operations controls.
 * No lesson ever clicks a Save, Submit, Approve, Verify, or Publish action for the user.
 * Changing business records requires a separate isolated demo environment.
 */
export const TRAINING_LESSONS: readonly TrainingLesson[] = [
  {
    id: 'orientation', title: 'Getting around Operations', summary: "Find your tasks, messages and team pages.",
    steps: [
      { path: '/', selector: '.ops-breadcrumb', title: "Your start page", body: "Today shows work that needs attention. Choose Next to begin." },
      { path: '/', selector: 'a[aria-label="My Work"]', title: "Open My Work", body: "Select My Work to see your assigned tasks.", advanceOnClick: true, requiresAction: true },
      { path: '/my-work', selector: '.ops-agenda, .ops-module', title: "Read your tasks", body: "Check what needs doing, the due date and who is responsible." },
      { path: '/my-work', selector: 'a.ops-notifications', title: "Open Notifications", body: "Select the bell to read new updates.", advanceOnClick: true, requiresAction: true },
      { path: '/notifications', selector: '.ops-module, main', title: "Read the update", body: "Read each update and check what needs doing." },
      { path: '/notifications', selector: 'a.ops-brand[href="/"]', title: "Return to Today", body: "Select the Hidden Oasis logo to return to Today.", advanceOnClick: true, requiresAction: true },
      { path: '/', selector: '.today-workspace', title: "Getting around complete", body: "Use the Training button whenever you want to repeat a lesson." },
    ],
  },
  {
    id: 'staff-handover', title: 'Reading a shift handover', summary: "Read what the previous shift left for you.",
    steps: [
      { path: '/shift', selector: '[aria-label="Shift note filters"] button', title: "Find unfinished notes", advanceOnClick: true, requiresAction: true, body: "Choose Unresolved or Urgent to find notes that need attention." },
      { path: '/shift', selector: '.ops-handover-card, .ops-module', title: "Read the note", body: "Check the problem, who is handling it and what needs to happen next. Reading a note does not finish the work." },
      { path: '/shift', selector: '.ops-module', title: "Ask for help", body: "Tell your lead if you cannot finish the work or change its status. Use your own login." },
    ],
  },
  {
    id: 'staff-rooms', title: 'Rooms and guest information', summary: "Find a room and its reported problems.",
    steps: [
      { path: '/rooms', selector: '[aria-label="Space type"] button', title: "Choose rooms or shared areas", advanceOnClick: true, requiresAction: true, body: "Select Guest rooms or Shared areas." },
      { path: '/rooms', selector: '[aria-label="Search rooms and areas"]', title: "Find a room", body: "Enter the room name, then open its card." },
      { path: '/rooms', selector: '.space-card, .ops-module', title: "Check existing reports", body: "Read any open guest issues or repairs before reporting the same problem again." },
    ],
  },
  {
    id: 'staff-my-work', title: 'Understanding assigned tasks', summary: "Check your tasks, priorities and due dates.",
    steps: [
      { path: '/my-work', selector: '.ops-agenda-overdue, .ops-agenda', title: "Check overdue tasks", body: "Read the task and due date. Tell your lead if you need help meeting the deadline." },
      { path: '/my-work', selector: '.ops-agenda-today, .ops-agenda', title: "Plan today's work", body: "Open each task to see what needs doing during your shift." },
      { path: '/my-work', selector: '.ops-agenda-waiting, .ops-agenda', title: "Check waiting tasks", body: "A task in Review or Waiting may still need a supervisor's decision." },
      { path: '/my-work', selector: 'a.ops-brand[href="/"]', title: "Return to Today", body: "Select the Hidden Oasis logo to finish this lesson.", advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'team-tasks', title: 'Creating and managing a task', summary: "Create a task and assign it to the right person.",
    requirement: 'manage_department',
    steps: [
      { path: '/tasks', selector: '[aria-label="Task view"]', title: "Board or List", body: "Board groups tasks by status. List shows tasks in rows." },
      { path: '/tasks', selector: '[placeholder="Search team tasks"]', title: "Check for an existing task", body: "Search before adding the same task again." },
      { path: '/tasks', selector: '[data-testid="create-task"]', title: "Open New task", body: "Select New task to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/tasks', selector: '[data-testid="create-task-form"] .form-grid', title: "Describe the task", body: "Add a clear title, due date, priority and person responsible. Example: Inspect Solace after checkout." },
      { path: '/tasks', selector: '[data-testid="create-task-form"] .toolbar button.secondary', title: "Close this example", body: "Choose Cancel. You will save a task during the hands-on practice.", advanceOnClick: true },
    ],
  },
  {
    id: 'guest-matters', title: "Recording a guest issue", summary: "Record the problem and arrange a follow-up.",
    requirement: 'manage_department',
    steps: [
      { path: '/guests', selector: '[aria-label="Guest matter filters"]', title: "Check existing reports", body: "Use Active or Urgent and check whether the issue has already been reported." },
      { path: '/guests', selector: '[data-testid="create-guest"]', title: "Open New guest matter", body: "Select New guest matter to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/guests', selector: '[data-testid="create-guest-form"]', title: "Record the problem", body: "Add the room, problem, priority and follow-up time. Example: Solace AC is not cooling; Maintenance needs to check it." },
      { path: '/guests', selector: '[data-testid="create-guest-form"] button.secondary', title: "Close this example", body: "Choose Cancel. You will save a guest report during the hands-on practice.", advanceOnClick: true },
    ],
  },
  {
    id: 'maintenance', title: 'Reporting and verifying maintenance', summary: "Report a repair and check the finished work.",
    requirement: 'manage_department',
    steps: [
      { path: '/fixes', selector: '[aria-label="Maintenance filters"]', title: "Check existing repairs", body: "Look in Active and Urgent first. A repair marked Done may still need a final check." },
      { path: '/fixes', selector: '[data-testid="create-fix"]', title: "Open Report issue", body: "Select Report issue to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/fixes', selector: '[data-testid="create-fix-form"]', title: "Describe the problem", body: "Add the room or area, the problem, priority and person assigned. Example: Solace AC is blowing warm air." },
      { path: '/fixes', selector: '[data-testid="create-fix-form"] button.secondary', title: "Close this example", body: "Choose Cancel. Management checks the finished repair before it is marked Verified.", advanceOnClick: true },
      { path: '/fixes', selector: '[aria-label="Maintenance work orders"]', title: "Read the repair status", body: "Open means waiting. Working means started. Done means waiting for a final check. Verified means the repair has been checked." },
    ],
  },
  {
    id: 'requests', title: "Requesting something for work", summary: "Explain what is needed and follow the decision.",
    requirement: 'manage_department',
    steps: [
      { path: '/requests', selector: '[aria-label="Request status"]', title: "Check existing requests", body: "Use the status filters to find requests already being handled." },
      { path: '/requests', selector: '[data-testid="create-request"]', title: "Open New request", body: "Select New request to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/requests', selector: '[data-testid="create-request-form"] .form-grid', title: "Explain what is needed", body: "Add a clear title, type and priority. Explain why it is needed and whether you have a price or quote." },
      { path: '/requests', selector: '[data-testid="create-request-form"] .toolbar button.secondary', title: "Close this example", body: "Choose Cancel. You will save and submit a request during the hands-on practice.", advanceOnClick: true },
    ],
  },
  {
    id: 'shift-writing', title: "Writing a shift note", summary: "Tell the next shift what still needs doing.",
    requirement: 'manage_department',
    steps: [
      { path: '/shift', selector: '[aria-label="Shift note filters"]', title: "Read unfinished notes", body: "Check what is already waiting before adding a note." },
      { path: '/shift', selector: '[data-testid="create-shift"]', title: "Open New handover", body: "Select New handover to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/shift', selector: '[data-testid="create-shift-form"] .form-grid', title: "Explain the next action", body: "Add the problem, who is handling it and when to check again. Example: Solace AC is still warm. Maintenance is checking it. Call the guest by 10 AM." },
      { path: '/shift', selector: '[data-testid="create-shift-form"] .toolbar button.secondary', title: "Close this example", body: "Choose Cancel. You will save a note during the hands-on practice.", advanceOnClick: true },
    ],
  },
  {
    id: 'projects', title: "Planning a project", summary: "Plan the work, due date and team tasks.",
    requirement: 'manage_department',
    steps: [
      { path: '/projects', selector: '[aria-label="Project status"]', title: "Check existing projects", body: "Use the status filters to see what is already planned or underway." },
      { path: '/projects', selector: '[data-testid="create-project"]', title: "Open New project", body: "Select New project to open the form.", advanceOnClick: true, requiresAction: true },
      { path: '/projects', selector: '[data-testid="create-project-form"] .form-grid', title: "Describe the project", body: "State what needs to be done, the due date, the team responsible and the next task." },
      { path: '/projects', selector: '[data-testid="create-project-form"] .toolbar button.secondary', title: "Close this example", body: "Choose Cancel to return to Projects.", advanceOnClick: true },
    ],
  },
  {
    id: 'bar', title: 'Bar reports and handovers', summary: 'Report Bar problems and check what the next shift needs.',
    barOnly: true,
    steps: [
      { path: '/bar', selector: '#bar-checks', title: 'Opening and closing', body: 'Read the actual approved checks if your lead has added them. This example does not make a new rule.' },
      { path: '/bar', selector: '[data-testid="bar-open-report"]', title: 'Open a report', body: 'Select Report a problem. Use Bar for alcoholic drinks and mocktails. Food goes to Kitchen; café drinks and café service go to Café.', advanceOnClick: true, requiresAction: true },
      { path: '/bar', selector: '[data-testid="bar-report-form"]', title: 'Describe what happened', body: 'Choose a type, describe the problem and say what the next person should do. Example: the mocktail blender stopped while preparing an order. Tell your lead if urgent.' },
      { path: '/bar', selector: '[data-testid="bar-report-form"] button.secondary', title: 'Close without saving', body: 'Select Cancel here. In your separate practice, use made-up details and save the report yourself.', advanceOnClick: true, requiresAction: true },
      { path: '/bar', selector: '[data-testid="bar-reports"]', title: 'Read Bar handovers', body: 'Open the report, read its status and add an update if something changed. Your lead can assign follow-up work.' },
    ],
  },
  {
    id: 'marketing', title: 'Preparing a marketing post', summary: "Prepare a post and ask for a review.",
    requirement: 'manage_department', marketingOnly: true,
    steps: [
      { path: '/posts', selector: '[aria-label="Filter Marketing by area"]', title: 'Find the promotion by area', body: 'Select Pool to see pool work, then Café for café work. A campaign may cover more than one area. Older work can show Areas not set.' },
      { path: '/posts', selector: '[aria-label="Marketing status"]', title: "Find posts that need work", body: "Use the status filters to find a draft or post waiting for review." },
      { path: '/posts', selector: '.marketing-workspace', title: 'Try single and combined promotions', body: 'For a Pool-only promotion, choose Pool when you create the campaign and post. For a Café and Bar event, tick both. Save only inside practice training, then find them using the area filter.' },
      { path: '/posts', selector: '.ops-content-heading, .ops-module', title: "Read the review status", body: "Review means waiting for a decision. Fix means changes are needed before approval." },
      { path: '/posts/editor', selector: '.ops-module, main', title: "Add feedback to an image", body: "Open an image and use text, arrows or highlights to explain the changes. Save a new version to keep your edits." },
      { path: '/posts/editor', selector: 'a.ops-brand[href="/"]', title: "Return to Today", body: "Select the Hidden Oasis logo to finish this lesson.", advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'management-review', title: 'Review and approval decisions', summary: "Read the details before approving or asking for changes.",
    requirement: 'make_decisions',
    steps: [
      { path: '/review', selector: '[placeholder="Search decisions"]', title: "Find an item to review", body: "Search for the request or issue and open its details." },
      { path: '/review', selector: '.queue-heading, .ops-module', title: "Choose the next action", body: "Approve only after checking the work. Give a clear reason when rejecting or asking for changes." },
      { path: '/approvals', selector: '[aria-label="Approval status"]', title: "Check the decision", body: "Pending means waiting. Approved means permission was given; the work may still need to be done." },
      { path: '/approvals', selector: 'a.ops-brand[href="/"]', title: "Finish this lesson", body: "Select the Hidden Oasis logo to return to Today.", advanceOnClick: true, requiresAction: true },
    ],
  },
  {
    id: 'accounts', title: "Managing staff accounts", summary: "Give each employee the access needed for their work.",
    requirement: 'manage_accounts',
    steps: [
      { path: '/admin/users', selector: '[placeholder="Search name, username, or role"]', title: "Find the employee", body: "Search before creating an account or resetting a password. Each employee uses their own login." },
      { path: '/admin/users', selector: '.ops-module, main', title: "Choose the right role", body: "Staff see their assigned work. Leads manage their team's work. Give manager or administrator access only when it is needed." },
      { path: '/admin/users', selector: '.ops-module, main', title: "Choose departments and a password", body: "Give access only to the employee's departments. Changing their role or stopping their account may require them to sign in again." },
      { path: '/admin/users', selector: 'a.ops-brand[href="/"]', title: "Finish this lesson", body: "Select the Hidden Oasis logo. Change account access only when the lesson asks you to.", advanceOnClick: true, requiresAction: true },
    ],
  },
];

export function availableTrainingLessons(
  capabilities: Record<string, boolean>,
  departments: { name?: string }[] = [],
): TrainingLesson[] {
  // Bar orientation is mandatory for actual Bar members, not managers viewing all departments.
  const bar = departments.some(d => String(d.name || '') === 'Bar');
  const marketing = Boolean(capabilities.view_all_operations)
    || departments.some(d => String(d.name || '').toLowerCase().includes('marketing'));
  return TRAINING_LESSONS.filter(lesson =>
    (!lesson.requirement || capabilities[lesson.requirement] === true)
    && (!lesson.marketingOnly || marketing)
    && (!lesson.barOnly || bar)
  );
}
