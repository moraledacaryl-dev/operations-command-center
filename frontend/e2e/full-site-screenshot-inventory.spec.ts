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
  owner: {
    id: 1,
    name: 'Owner',
    email: 'owner@example.test',
    role: 'owner',
    primary_department_id: 1,
    departments,
    capabilities: capabilities([...capabilityKeys]),
  },
  admin: {
    id: 2,
    name: 'Admin',
    email: 'admin@example.test',
    role: 'admin',
    primary_department_id: 1,
    departments,
    capabilities: capabilities([
      'view_all_operations', 'manage_department', 'manage_accounts', 'manage_system',
      'view_system_health', 'manage_approvals', 'view_sensitive_user_metadata', 'view_integration_summary',
    ]),
  },
  manager: {
    id: 3,
    name: 'Manager',
    email: 'manager@example.test',
    role: 'manager',
    primary_department_id: 1,
    departments,
    capabilities: capabilities([
      'view_all_operations', 'manage_department', 'make_decisions', 'manage_approvals', 'view_integration_summary',
    ]),
  },
  supervisor: {
    id: 4,
    name: 'Supervisor',
    email: 'supervisor@example.test',
    role: 'supervisor',
    primary_department_id: 1,
    departments,
    capabilities: capabilities(['manage_department']),
  },
  staff: {
    id: 5,
    name: 'Staff',
    email: 'staff@example.test',
    role: 'staff',
    primary_department_id: 1,
    departments,
    capabilities: capabilities([]),
  },
};

const ownerRoutes = [
  '/', '/account', '/admin/approve', '/admin/health', '/admin/users', '/approvals', '/approve',
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

function fileSlug(path: string) {
  if (path === '/') return 'home';
  return path.replace(/^\//, '').replaceAll('/', '--') || 'home';
}

async function seedAuthenticatedShell(page: Page, user: SessionUser) {
  await page.addInitScript(({ session, dept }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(dept));
  }, { session: user, dept: user.primary_department_id });

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];

    if (path.endsWith('/api/auth/me')) body = user;
    else if (path.endsWith('/api/dashboard')) body = { counts: {}, approvals: [], previous_shift: [] };
    else if (path.endsWith('/api/my-work')) body = { groups: { overdue: [], today: [], waiting: [], upcoming: [] } };
    else if (path.endsWith('/api/integrations/overview')) body = {};
    else if (path.includes('/api/departments/1/workspace')) body = {
      department: departments[0],
      tasks: [], talk: [], shift: [], requests: [], projects: [], routines: [], docs: [], people: [], history: [],
    };
    else if (path.match(/\/api\/rooms\/\d+$/)) body = { id: 1, name: 'Room 1', kind: 'Room', status: 'Active' };
    else if (path.endsWith('/api/meta')) body = { departments };
    else if (path.endsWith('/api/users')) body = Object.values(users);
    else if (path.endsWith('/api/users/page')) body = cursorPage(Object.values(users));
    else if (path.endsWith('/api/history/search/all')) body = cursorPage();
    else if (path.endsWith('/api/notifications')) body = { ...cursorPage(), unread_count: 0 };
    else if (url.searchParams.get('paginated') === 'true') body = cursorPage();

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function capture(page: Page, role: string, viewport: string, path: string) {
  await page.goto(path);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('#__next_error__')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.screenshot({
    path: `test-results/ui-audit/site-${role}-${viewport}-${fileSlug(path)}.png`,
    fullPage: true,
  });
}

test.beforeAll(() => {
  mkdirSync('test-results/ui-audit', { recursive: true });
});

for (const viewport of viewports) {
  test(`captures public login at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
    await page.screenshot({
      path: `test-results/ui-audit/site-public-${viewport.name}-login.png`,
      fullPage: true,
    });
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
