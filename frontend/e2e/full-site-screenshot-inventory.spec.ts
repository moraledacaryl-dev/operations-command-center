import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const departments = [
  { id: 1, name: 'Front Office', is_primary: true },
  { id: 2, name: 'Housekeeping', is_primary: false },
  { id: 3, name: 'Marketing', is_primary: false },
];

type RoleName = 'owner' | 'admin' | 'manager' | 'supervisor' | 'staff';

type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: RoleName;
  primary_department_id: number;
  departments: typeof departments;
  capabilities: Record<string, boolean>;
};

const capabilityKeys = [
  'view_all_operations',
  'manage_department',
  'make_decisions',
  'manage_accounts',
  'manage_system',
  'view_system_health',
  'manage_approvals',
  'view_sensitive_user_metadata',
  'view_integration_summary',
] as const;

function capabilities(enabled: string[]) {
  return Object.fromEntries(capabilityKeys.map(key => [key, enabled.includes(key)]));
}

const users: Record<RoleName, SessionUser> = {
  owner: { id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner', primary_department_id: 1, departments, capabilities: capabilities([...capabilityKeys]) },
  admin: { id: 2, name: 'Admin', email: 'admin@example.test', role: 'admin', primary_department_id: 1, departments, capabilities: capabilities(['view_all_operations', 'manage_department', 'manage_accounts', 'manage_system', 'view_system_health', 'manage_approvals', 'view_sensitive_user_metadata', 'view_integration_summary']) },
  manager: { id: 3, name: 'Manager', email: 'manager@example.test', role: 'manager', primary_department_id: 1, departments, capabilities: capabilities(['view_all_operations', 'manage_department', 'make_decisions', 'manage_approvals', 'view_integration_summary']) },
  supervisor: { id: 4, name: 'Supervisor', email: 'supervisor@example.test', role: 'supervisor', primary_department_id: 1, departments, capabilities: capabilities(['manage_department']) },
  staff: { id: 5, name: 'Staff', email: 'staff@example.test', role: 'staff', primary_department_id: 1, departments, capabilities: capabilities([]) },
};

const sampleImageBase64 = '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';

const sampleTasks = [
  { id: 11, title: 'Fix leaking faucet — Room 203', status: 'To Do', priority: 'High', due_date: '2026-09-05T14:00:00+08:00', department_id: 1, department_name: 'Front Office' },
  { id: 12, title: 'Paint touch-up — Lobby', status: 'Doing', priority: 'Normal', due_date: '2026-09-08T10:00:00+08:00', department_id: 1, department_name: 'Front Office' },
  { id: 13, title: 'Review supplier invoice #445', status: 'Review', priority: 'High', due_date: '2026-09-07T12:00:00+08:00', department_id: 1, department_name: 'Front Office' },
  { id: 14, title: 'Replace light bulbs — Block A', status: 'Done', priority: 'Normal', due_date: '2026-09-04T09:00:00+08:00', department_id: 1, department_name: 'Front Office' },
];

const sampleProjects = [
  { id: 21, title: 'Pool Expansion Study', status: 'Active', priority: 'Normal', due_date: '2026-10-15', department_id: 1 },
  { id: 22, title: 'Café Outdoor Area', status: 'Active', priority: 'High', due_date: '2026-11-30', department_id: 1 },
  { id: 23, title: 'Marketing Campaign Q4', status: 'Planned', priority: 'Normal', due_date: '2026-12-15', department_id: 1 },
  { id: 24, title: 'Staff Training Program', status: 'Paused', priority: 'Normal', due_date: '2026-12-20', department_id: 1 },
];

const sampleRequests = [
  { id: 31, title: 'New outdoor furniture', status: 'Review', urgency: 'Normal', request_type: 'Equipment', reason: 'Replace weathered seating in the garden.', department_id: 1 },
  { id: 32, title: 'Additional housekeeping staff', status: 'Approved', urgency: 'Normal', request_type: 'Staffing', reason: 'Support peak occupancy and faster room turns.', department_id: 1 },
  { id: 33, title: 'Pool maintenance schedule', status: 'Planned', urgency: 'Low', request_type: 'Maintenance', reason: 'Formalize weekly preventive maintenance.', department_id: 1 },
  { id: 34, title: 'Marketing campaign — October', status: 'Draft', urgency: 'Normal', request_type: 'Marketing', reason: 'Prepare seasonal content and offers.', department_id: 1 },
];

const sampleRooms = [
  { id: 1, name: 'Room 101', kind: 'Deluxe', status: 'Occupied' },
  { id: 2, name: 'Room 102', kind: 'Standard', status: 'Occupied' },
  { id: 3, name: 'Room 103', kind: 'Standard', status: 'Vacant' },
  { id: 4, name: 'Room 105', kind: 'Deluxe', status: 'Maintenance' },
  { id: 5, name: 'Room 106', kind: 'Standard', status: 'Vacant' },
  { id: 6, name: 'Room 107', kind: 'Deluxe', status: 'Occupied' },
];

const sampleGuests = [
  { id: 41, title: 'AC not cooling', guest_name: 'Maria Santos', room_area_id: 1, issue_type: 'Room', urgency: 'High', status: 'Open', follow_up_date: '2026-09-07T10:00:00+08:00', note: 'Guest reported weak cooling.' },
  { id: 42, title: 'Extra towels', guest_name: 'John Dela Cruz', room_area_id: 2, issue_type: 'Request', urgency: 'Normal', status: 'Follow', follow_up_date: '2026-09-06T20:00:00+08:00', note: 'Deliver two additional bath towels.' },
  { id: 43, title: 'Late checkout request', guest_name: 'Ana Reyes', room_area_id: 3, issue_type: 'Checkout', urgency: 'Low', status: 'Done', follow_up_date: '2026-09-06T14:00:00+08:00', note: 'Approved until 1 PM.' },
];

const sampleFixes = [
  { id: 51, title: 'Pool pump leaking', room_area_id: 4, urgency: 'High', status: 'Open', assigned_to_id: 4, problem: 'Leak visible at pump coupling.' },
  { id: 52, title: 'Broken door lock', room_area_id: 1, urgency: 'Normal', status: 'Working', assigned_to_id: 4, problem: 'Lock intermittently jams.' },
  { id: 53, title: 'Garden lights out', room_area_id: 5, urgency: 'Low', status: 'Done', assigned_to_id: 5, problem: 'Three path lights not working.' },
  { id: 54, title: 'Aircon not cold', room_area_id: 1, urgency: 'Normal', status: 'Verified', assigned_to_id: 4, problem: 'Filter cleaned and refrigerant checked.' },
];

const sampleShift = [
  { id: 61, title: 'Morning shift', shift: 'AM', category: 'Staff', urgency: 'Normal', status: 'New', note: 'VIP arrival at noon; coordinate welcome setup.', created_at: '2026-09-06T08:00:00+08:00', created_by_name: 'Maria' },
  { id: 62, title: 'Afternoon shift', shift: 'PM', category: 'Guest', urgency: 'Normal', status: 'Seen', note: 'Follow up Room 102 towel request.', created_at: '2026-09-06T13:00:00+08:00', created_by_name: 'John' },
  { id: 63, title: 'Evening shift', shift: 'Night', category: 'Fix', urgency: 'Urgent', status: 'Follow', note: 'Check pool pump before closing rounds.', created_at: '2026-09-06T18:00:00+08:00', created_by_name: 'Bronce' },
  { id: 64, title: 'Previous morning shift', shift: 'AM', category: 'Other', urgency: 'Low', status: 'Done', note: 'All opening checks completed.', created_at: '2026-09-05T08:00:00+08:00', created_by_name: 'Maria' },
];

const sampleApprovals = [
  { id: 71, title: 'Purchase order #1042', status: 'Pending', priority: 'High', source_type: 'request', note: 'Cleaning supplies replenishment.', requested_by_name: 'Juan', created_at: '2026-09-06T09:00:00+08:00' },
  { id: 72, title: 'Staff overtime — Maria Santos', status: 'Pending', priority: 'Normal', source_type: 'staffing', note: 'Peak weekend coverage.', requested_by_name: 'Manager', created_at: '2026-09-06T10:30:00+08:00' },
  { id: 73, title: 'Marketing budget — October', status: 'Pending', priority: 'Low', source_type: 'marketing', note: 'October social campaign.', requested_by_name: 'Marketing', created_at: '2026-09-06T11:00:00+08:00' },
];

const sampleHistory = [
  { id: 81, action: 'User login', message: 'Owner signed in', created_at: '2026-09-06T08:00:00+08:00' },
  { id: 82, action: 'Task updated', message: 'Room 203 faucet moved to To Do', created_at: '2026-09-06T09:30:00+08:00' },
  { id: 83, action: 'Approval completed', message: 'Approval decision recorded', created_at: '2026-09-06T10:15:00+08:00' },
];

const sampleNotifications = [
  { id: 91, title: 'New guest matter — Room 302', body: 'AC not cooling', is_read: false, created_at: '2026-09-06T13:00:00+08:00' },
  { id: 92, title: 'Approval required — PO #1042', body: 'Decision waiting', is_read: false, created_at: '2026-09-06T12:00:00+08:00' },
  { id: 93, title: 'Task assigned — Pool inspection', body: 'New task assigned', is_read: true, created_at: '2026-09-06T11:00:00+08:00' },
];

const propertyMedia = [
  { slot: 'login_background', label: 'Login background', configured: true, content_url: '/api/property-media/login_background/content', updated_at: '2026-09-06T08:00:00Z' },
  { slot: 'dashboard_hero', label: 'Dashboard hero', configured: true, content_url: '/api/property-media/dashboard_hero/content', updated_at: '2026-09-06T08:00:00Z' },
  { slot: 'property_cover', label: 'Property cover', configured: true, content_url: '/api/property-media/property_cover/content', updated_at: '2026-09-06T08:00:00Z' },
  { slot: 'room_placeholder', label: 'Default room placeholder', configured: true, content_url: '/api/property-media/room_placeholder/content', updated_at: '2026-09-06T08:00:00Z' },
];

const ownerRoutes = [
  '/', '/account', '/admin/appearance', '/admin/approve', '/admin/health', '/admin/users', '/approvals', '/approve',
  '/departments', '/fixes', '/guests', '/history', '/my-work', '/notifications', '/posts', '/posts/editor',
  '/projects', '/requests', '/review', '/rooms', '/rooms/1', '/shift', '/tasks',
];

const roleRoutes: Record<Exclude<RoleName, 'owner'>, string[]> = {
  admin: ['/', '/account', '/admin/health', '/admin/users', '/approvals', '/departments', '/history', '/my-work', '/requests', '/review', '/tasks'],
  manager: ['/', '/account', '/approvals', '/departments', '/history', '/my-work', '/requests', '/review', '/tasks'],
  supervisor: ['/', '/account', '/departments', '/fixes', '/guests', '/my-work', '/requests', '/shift', '/tasks'],
  staff: ['/', '/account', '/departments', '/my-work', '/requests', '/shift', '/tasks'],
};

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];

function cursorPage(items: unknown[] = []) {
  return { items, next_cursor: null, has_more: false };
}

function pageOrArray(url: URL, items: unknown[]) {
  return url.searchParams.get('paginated') === 'true' ? cursorPage(items) : items;
}

function fileSlug(path: string) {
  if (path === '/') return 'home';
  return path.replace(/^\//, '').replaceAll('/', '--') || 'home';
}

async function fulfillPropertyMediaContent(route: any, path: string) {
  if (!path.startsWith('/api/property-media/') || !path.endsWith('/content')) return false;
  await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(sampleImageBase64, 'base64') });
  return true;
}

async function seedPublicMedia(page: Page) {
  await page.route('**/api/property-media**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (await fulfillPropertyMediaContent(route, path)) return;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(propertyMedia) });
  });
}

async function seedAuthenticatedShell(page: Page, user: SessionUser) {
  await page.addInitScript(({ session, dept }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(dept));
  }, { session: user, dept: user.primary_department_id });

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (await fulfillPropertyMediaContent(route, path)) return;

    let body: unknown = [];
    if (path === '/api/property-media') body = propertyMedia;
    else if (path === '/api/auth/me') body = user;
    else if (path === '/api/dashboard') body = { counts: { approve: 3, fixes: 3 }, approvals: sampleApprovals, previous_shift: sampleShift.slice(0, 3) };
    else if (path === '/api/my-work') body = { groups: { overdue: [sampleTasks[0]], today: [sampleTasks[1]], waiting: [sampleTasks[2]], upcoming: [sampleTasks[3]], completed: [] } };
    else if (path === '/api/integrations/overview') body = { hidden_oasis_staff_payroll: { open: 1 }, accounting_program: { open: 0 }, dedicated_pos_cloud: { open: 2 } };
    else if (path === '/api/departments/1/workspace') body = { department: departments[0], tasks: sampleTasks, talk: [], shift: sampleShift, requests: sampleRequests, projects: sampleProjects, routines: [], docs: [], people: Object.values(users), history: sampleHistory };
    else if (path === '/api/rooms/1/memory') body = { room: sampleRooms[0], guests: sampleGuests.filter(item => item.room_area_id === 1), fixes: sampleFixes.filter(item => item.room_area_id === 1) };
    else if (path.match(/^\/api\/rooms\/\d+$/)) body = sampleRooms[0];
    else if (path === '/api/meta') body = { departments, users: Object.values(users) };
    else if (path === '/api/users') body = Object.values(users);
    else if (path === '/api/users/page') body = cursorPage(Object.values(users));
    else if (path === '/api/history/search/all') body = cursorPage(sampleHistory);
    else if (path === '/api/notifications') body = { ...cursorPage(sampleNotifications), unread_count: 2 };
    else if (path === '/api/review/queue') body = {
      external: [{ id: 101, title: 'Accounting event', status: 'For Review', priority: 'High', summary: 'Journal entry requires operational context.', created_at: '2026-09-06T08:00:00Z' }],
      approvals: sampleApprovals,
      submissions: [{ id: 102, title: 'Inventory event', review_status: 'New', priority: 'Normal', summary: 'Stock variance submitted for review.', submitted_at: '2026-09-06T09:00:00Z' }],
      posts: [{ id: 103, title: 'Weekend getaway post', status: 'Review', priority: 'Low', caption: 'Campaign creative ready for approval.', created_at: '2026-09-06T10:00:00Z' }],
      fixes: sampleFixes.filter(item => item.status === 'Done'),
    };
    else if (path === '/api/tasks') body = pageOrArray(url, sampleTasks);
    else if (path === '/api/projects') body = pageOrArray(url, sampleProjects);
    else if (path === '/api/requests') body = pageOrArray(url, sampleRequests);
    else if (path === '/api/guests') body = pageOrArray(url, sampleGuests);
    else if (path === '/api/fixes') body = pageOrArray(url, sampleFixes);
    else if (path === '/api/rooms') body = pageOrArray(url, sampleRooms);
    else if (path === '/api/shift-notes') body = pageOrArray(url, sampleShift);
    else if (path === '/api/approvals') body = pageOrArray(url, sampleApprovals);
    else if (path === '/api/posts') body = pageOrArray(url, [{ id: 111, title: 'September Campaign', status: 'Draft', platform: 'Instagram', content_type: 'Static', post_date: '2026-09-12', caption: 'A smoother stay for a brighter tomorrow.', department_id: 3 }]);
    else if (path === '/api/health') body = { readiness: { ok: true, warnings: [] } };
    else if (url.searchParams.get('paginated') === 'true') body = cursorPage();

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function capture(page: Page, role: string, viewport: string, path: string) {
  await page.goto(path);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('#__next_error__')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.screenshot({ path: `test-results/ui-audit/site-${role}-${viewport}-${fileSlug(path)}.png`, fullPage: true });
}

test.beforeAll(() => {
  mkdirSync('test-results/ui-audit', { recursive: true });
});

for (const viewport of viewports) {
  test(`captures public login at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedPublicMedia(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
    await page.screenshot({ path: `test-results/ui-audit/site-public-${viewport.name}-login.png`, fullPage: true });
  });

  for (const path of ownerRoutes) {
    test(`captures owner ${path} at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedAuthenticatedShell(page, users.owner);
      await capture(page, 'owner', viewport.name, path);
    });
  }

  for (const role of ['admin', 'manager', 'supervisor', 'staff'] as const) {
    for (const path of roleRoutes[role]) {
      test(`captures ${role} ${path} at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await seedAuthenticatedShell(page, users[role]);
        await capture(page, role, viewport.name, path);
      });
    }
  }
}
