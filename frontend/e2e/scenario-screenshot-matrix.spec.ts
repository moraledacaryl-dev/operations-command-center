import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'test-results/ui-audit';
mkdirSync(OUT, { recursive: true });

const departments = [
  { id: 1, name: 'Front Office', is_primary: true },
  { id: 2, name: 'Housekeeping', is_primary: false },
  { id: 3, name: 'Marketing', is_primary: false },
];
const owner = {
  id: 1,
  name: 'Owner',
  email: 'owner@example.test',
  role: 'owner',
  primary_department_id: 1,
  departments,
  capabilities: {
    view_all_operations: true,
    manage_department: true,
    make_decisions: true,
    manage_accounts: true,
    manage_system: true,
    view_system_health: true,
    manage_approvals: true,
    view_sensitive_user_metadata: true,
    view_integration_summary: true,
  },
};

const tasks = [
  { id: 11, title: 'Fix leaking faucet — Room 2', status: 'To Do', priority: 'Urgent', due_date: '2026-09-08', department_id: 1, allowed_actions: ['start'] },
  { id: 12, title: 'Prepare weekend arrival packs', status: 'Doing', priority: 'High', due_date: '2026-09-12', department_id: 1, allowed_actions: ['submit-review'] },
  { id: 13, title: 'Review pool safety signage', status: 'Review', priority: 'Normal', due_date: '2026-09-13', department_id: 1, allowed_actions: ['request-changes', 'complete'] },
  { id: 14, title: 'Archive August handover notes', status: 'Done', priority: 'Low', due_date: '2026-09-06', department_id: 1, allowed_actions: ['reopen'] },
];
const requests = [
  { id: 21, title: 'Replace reception printer', status: 'Draft', urgency: 'Normal', request_type: 'Equipment', reason: 'Current unit jams during check-in.', department_id: 1 },
  { id: 22, title: 'Add weekend housekeeping coverage', status: 'Review', urgency: 'Urgent', request_type: 'Staffing', reason: 'Peak turnover coverage.', department_id: 1 },
  { id: 23, title: 'Lobby welcome signage', status: 'Approved', urgency: 'Low', request_type: 'Marketing', reason: 'Improve arrival experience.', department_id: 1 },
  { id: 24, title: 'Pool pump preventive service', status: 'Planned', urgency: 'Normal', request_type: 'Maintenance', reason: 'Scheduled preventive maintenance.', department_id: 1 },
  { id: 25, title: 'Old linen disposal', status: 'Done', urgency: 'Low', request_type: 'Process', reason: 'Completed inventory cleanup.', department_id: 1 },
  { id: 26, title: 'Unsupported vendor request', status: 'Rejected', urgency: 'Normal', request_type: 'Supply', reason: 'Vendor requirements not met.', department_id: 1 },
];
const fixes = [
  { id: 31, title: 'Guest shower pressure', status: 'Open', urgency: 'Urgent', problem: 'Low pressure reported.', room_area_id: 1, assigned_to_id: 4, department_id: 1 },
  { id: 32, title: 'Garden light replacement', status: 'Working', urgency: 'Normal', problem: 'Two lamps out.', room_area_id: 2, assigned_to_id: 4, department_id: 1 },
  { id: 33, title: 'Function hall outlet', status: 'Done', urgency: 'High', problem: 'Repair completed; verify load.', room_area_id: 3, assigned_to_id: 4, department_id: 1 },
  { id: 34, title: 'Reception door closer', status: 'Verified', urgency: 'Low', problem: 'Verified after adjustment.', room_area_id: 1, assigned_to_id: 4, department_id: 1 },
];
const rooms = [
  { id: 1, name: 'Room 2' },
  { id: 2, name: 'Garden' },
  { id: 3, name: 'Function Hall' },
];
const projects = [
  { id: 41, title: 'Outdoor restaurant launch', status: 'Active', priority: 'High', department_id: 1 },
  { id: 42, title: 'Holiday campaign prep', status: 'Planned', priority: 'Normal', department_id: 1 },
  { id: 43, title: 'Pool deck refresh', status: 'Paused', priority: 'Normal', department_id: 1 },
  { id: 44, title: 'August guest guide update', status: 'Done', priority: 'Low', department_id: 1 },
];
const guests = [
  { id: 51, title: 'Late airport transfer', guest_name: 'Maria Santos', status: 'Open', urgency: 'High', room_area_id: 1, department_id: 1 },
  { id: 52, title: 'Dietary follow-up', guest_name: 'Alex Cruz', status: 'Follow', urgency: 'Normal', room_area_id: 1, department_id: 1 },
  { id: 53, title: 'Anniversary setup', guest_name: 'Jamie Reyes', status: 'Done', urgency: 'Low', room_area_id: 1, department_id: 1 },
];
const shifts = [
  { id: 61, title: 'AM: VIP arrival handoff', status: 'New', shift_group: 'AM', note: 'Confirm welcome setup.', department_id: 1 },
  { id: 62, title: 'PM: Pool towel stock', status: 'Seen', shift_group: 'PM', note: 'Restocked at 15:00.', department_id: 1 },
  { id: 63, title: 'Night: Gate access follow-up', status: 'Follow', shift_group: 'Night', note: 'Confirm contractor exit.', department_id: 1 },
  { id: 64, title: 'AM: Breakfast count', status: 'Done', shift_group: 'AM', note: 'Completed.', department_id: 1 },
];
const approvals = [
  { id: 71, title: 'Weekend staffing request', status: 'Pending', priority: 'High', request_id: 22, department_id: 1 },
  { id: 72, title: 'Printer replacement', status: 'Approved', priority: 'Normal', request_id: 21, department_id: 1 },
  { id: 73, title: 'Vendor exception', status: 'Rejected', priority: 'Low', department_id: 1 },
];
const notifications = [
  { id: 81, title: 'Request awaiting review', message: 'Weekend staffing request needs a decision.', read_at: null, created_at: '2026-09-12T08:00:00Z' },
  { id: 82, title: 'Maintenance completed', message: 'Function hall outlet is ready for verification.', read_at: null, created_at: '2026-09-12T07:30:00Z' },
  { id: 83, title: 'Task completed', message: 'August handover notes were archived.', read_at: '2026-09-12T07:00:00Z', created_at: '2026-09-12T06:45:00Z' },
];

function cursorPage(items: unknown[] = []) {
  return { items, next_cursor: null, has_more: false };
}
function pageOrArray(url: URL, items: unknown[]) {
  return url.searchParams.get('paginated') === 'true' ? cursorPage(items) : items;
}

async function seedOwnerScenario(page: Page) {
  await page.addInitScript(({ session, dept }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(dept));
  }, { session: owner, dept: 1 });

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];

    if (path === '/api/auth/me') body = owner;
    else if (path === '/api/meta') body = { departments, users: [owner, { id: 4, name: 'Supervisor', role: 'supervisor' }] };
    else if (path === '/api/dashboard') body = { counts: { approve: 1, fixes: 3 }, approvals, previous_shift: shifts.slice(0, 3) };
    else if (path === '/api/notifications') body = { ...cursorPage(notifications), unread_count: 2 };
    else if (path === '/api/tasks') body = pageOrArray(url, tasks);
    else if (path.match(/^\/api\/tasks\/\d+$/)) body = tasks.find(item => item.id === Number(path.split('/').at(-1))) || tasks[0];
    else if (path === '/api/requests') body = pageOrArray(url, requests);
    else if (path === '/api/fixes') body = pageOrArray(url, fixes);
    else if (path === '/api/rooms') body = pageOrArray(url, rooms);
    else if (path === '/api/projects') body = pageOrArray(url, projects);
    else if (path === '/api/guests') body = pageOrArray(url, guests);
    else if (path === '/api/shift-notes') body = pageOrArray(url, shifts);
    else if (path === '/api/approvals') body = pageOrArray(url, approvals);
    else if (path === '/api/review/queue') body = {
      external: [{ id: 91, title: 'Accounting event', status: 'For Review', priority: 'High', summary: 'Journal entry requires operational context.', created_at: '2026-09-12T08:00:00Z' }],
      approvals,
      submissions: [{ id: 92, title: 'Inventory variance', review_status: 'New', priority: 'Normal', summary: 'Stock variance submitted for review.', submitted_at: '2026-09-12T09:00:00Z' }],
      posts: [{ id: 93, title: 'Weekend getaway post', status: 'Review', priority: 'Low', caption: 'Campaign creative ready for approval.', created_at: '2026-09-12T10:00:00Z' }],
      fixes: fixes.filter(item => item.status === 'Done'),
    };
    else if (path === '/api/integrations/overview') body = { hidden_oasis_staff_payroll: { open: 1 }, accounting_program: { open: 0 }, dedicated_pos_cloud: { open: 2 } };
    else if (path.match(/^\/api\/rooms\/\d+$/)) body = rooms[0];
    else if (url.searchParams.get('paginated') === 'true') body = cursorPage();

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

type Scenario = {
  id: string;
  route: string;
  description: string;
  viewport?: { width: number; height: number };
  ready: (page: Page) => Promise<void>;
  prepare?: (page: Page) => Promise<void>;
};

async function shellReady(page: Page) {
  await expect(page.locator('#operations-app-root')).toBeVisible();
  await expect(page.locator('#__next_error__')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function shot(page: Page, id: string) {
  await shellReady(page);
  await page.screenshot({ path: `${OUT}/scenario-${id}.png`, fullPage: true });
}

const scenarios: Scenario[] = [
  { id: 'tasks-board-populated', route: '/tasks', description: 'Task board with all four workflow statuses', ready: async page => { await expect(page.getByTestId('tasks-board')).toBeVisible(); await expect(page.getByText('Fix leaking faucet — Room 2')).toBeVisible(); } },
  { id: 'requests-workflow-populated', route: '/requests', description: 'Requests with draft/review/approved/planned/done/rejected fixtures', ready: async page => { await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible(); await expect(page.getByText('Replace reception printer')).toBeVisible(); } },
  { id: 'approvals-populated', route: '/approvals', description: 'Approval queue populated state', ready: async page => { await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible(); } },
  { id: 'review-populated', route: '/review', description: 'Review queue populated state', ready: async page => { await expect(page.getByRole('heading', { name: /Review/ })).toBeVisible(); await expect(page.getByText('Accounting event')).toBeVisible(); } },
  { id: 'shift-populated', route: '/shift', description: 'Shift handoff with New/Seen/Follow/Done fixtures', ready: async page => { await expect(page.getByRole('heading', { name: /Shift/ })).toBeVisible(); } },
  { id: 'maintenance-populated', route: '/fixes', description: 'Maintenance Open/Working/Done/Verified fixtures', ready: async page => { await expect(page.getByRole('heading', { name: 'Maintenance' })).toBeVisible(); await expect(page.getByText('Guest shower pressure')).toBeVisible(); } },
  { id: 'guest-matters-populated', route: '/guests', description: 'Guest matters Open/Follow/Done fixtures', ready: async page => { await expect(page.getByRole('heading', { name: /Guest/ })).toBeVisible(); } },
  { id: 'notifications-populated', route: '/notifications', description: 'Read and unread notifications', ready: async page => { await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible(); await expect(page.getByText('Request awaiting review')).toBeVisible(); } },
  { id: 'projects-populated', route: '/projects', description: 'Projects Planned/Active/Paused/Done fixtures', ready: async page => { await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible(); } },
  {
    id: 'mobile-navigation-drawer-open', route: '/', description: 'Mobile navigation drawer open', viewport: { width: 390, height: 844 },
    ready: async page => { await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible(); },
    prepare: async page => { await page.getByRole('button', { name: 'Open navigation' }).click(); await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Close navigation' }).first()).toBeVisible(); },
  },
  {
    id: 'task-create-surface-open', route: '/tasks', description: 'Task create surface open', ready: async page => { await expect(page.getByTestId('create-task')).toBeVisible(); },
    prepare: async page => { await page.getByTestId('create-task').click(); await expect(page.getByRole('heading', { name: 'Create team task' })).toBeVisible(); },
  },
  {
    id: 'task-detail-drawer-open', route: '/tasks', description: 'Task detail drawer with workflow actions', ready: async page => { await expect(page.getByTestId('tasks-board')).toBeVisible(); },
    prepare: async page => { await page.getByRole('button', { name: /Fix leaking faucet/ }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByText('Move task')).toBeVisible(); },
  },
  {
    id: 'request-create-surface-open', route: '/requests', description: 'Request create surface open', ready: async page => { await expect(page.getByTestId('create-request')).toBeVisible(); },
    prepare: async page => { await page.getByTestId('create-request').click(); await expect(page.getByRole('heading', { name: 'New request' })).toBeVisible(); },
  },
  {
    id: 'request-detail-drawer-open', route: '/requests', description: 'Request detail drawer at Draft status', ready: async page => { await expect(page.getByText('Replace reception printer')).toBeVisible(); },
    prepare: async page => { await page.getByRole('button', { name: /Replace reception printer/ }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByText('Send for review')).toBeVisible(); },
  },
  {
    id: 'maintenance-create-surface-open', route: '/fixes', description: 'Maintenance create surface open', ready: async page => { await expect(page.getByTestId('create-fix')).toBeVisible(); },
    prepare: async page => { await page.getByTestId('create-fix').click(); await expect(page.getByTestId('create-fix-form')).toBeVisible(); },
  },
  {
    id: 'maintenance-verify-drawer-open', route: '/fixes', description: 'Maintenance Done item awaiting verification', ready: async page => { await expect(page.getByText('Function hall outlet')).toBeVisible(); },
    prepare: async page => { await page.getByRole('button', { name: /Function hall outlet/ }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('heading', { name: 'Verify closure' })).toBeVisible(); },
  },
];

test.describe('scenario screenshot matrix', () => {
  for (const scenario of scenarios) {
    test(scenario.id, async ({ page }) => {
      await page.setViewportSize(scenario.viewport || { width: 1440, height: 1000 });
      await seedOwnerScenario(page);
      await page.goto(scenario.route, { waitUntil: 'domcontentloaded' });
      await shellReady(page);
      await scenario.ready(page);
      await scenario.prepare?.(page);
      await shot(page, scenario.id);
    });
  }

  test.afterAll(() => {
    writeFileSync(`${OUT}/scenario-manifest.json`, JSON.stringify({
      purpose: 'Interactive/state coverage supplement to full-site screenshot inventory',
      scenarios: scenarios.map(({ id, route, description, viewport }) => ({ id, route, description, viewport: viewport ? 'mobile' : 'desktop' })),
      coverage: {
        baseline: 'route × role × desktop/mobile',
        supplement: ['workflow-status fixtures', 'mobile navigation open', 'create surfaces open', 'detail drawers open', 'verification/action state'],
        nextCandidates: ['validation errors', 'destructive confirmations', 'empty/loading/API-error states', 'dropdown/date-picker states', 'success/error toasts', 'Marketing editor states', 'Annotation Studio tool/object states'],
      },
    }, null, 2));
  });
});
