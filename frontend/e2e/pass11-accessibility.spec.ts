import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const departments = [
  { id: 1, name: 'Front Office', is_primary: true },
  { id: 2, name: 'Housekeeping', is_primary: false },
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

const routes = [
  '/', '/account', '/admin/approve', '/admin/health', '/admin/users', '/approvals', '/approve',
  '/departments', '/fixes', '/guests', '/history', '/my-work', '/posts', '/posts/editor', '/projects', '/requests',
  '/review', '/rooms', '/rooms/1', '/shift', '/tasks', '/notifications', '/does-not-exist',
];

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 720 },
];

async function seedAuthenticatedShell(page: Page) {
  await page.addInitScript(({ session, dept }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(dept));
  }, { session: owner, dept: 1 });

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];

    if (path.endsWith('/api/auth/me')) body = owner;
    else if (path.endsWith('/api/dashboard')) body = { counts: {}, approvals: [], previous_shift: [] };
    else if (path.endsWith('/api/my-work')) body = { groups: { overdue: [], today: [], waiting: [], upcoming: [] } };
    else if (path.endsWith('/api/integrations/overview')) body = {};
    else if (path.includes('/api/departments/1/workspace')) body = {
      department: departments[0],
      tasks: [], talk: [], shift: [], requests: [], projects: [], routines: [], docs: [], people: [], history: [],
    };
    else if (path.match(/\/api\/rooms\/\d+$/)) body = { id: 1, name: 'Room 1', kind: 'Room', status: 'Active' };
    else if (path.endsWith('/api/meta')) body = { departments };
    else if (path.endsWith('/api/users')) body = [owner];
    else if (path.endsWith('/api/users/page')) body = { items: [owner], next_cursor: null, has_more: false };
    else if (path.endsWith('/api/history/search/all')) body = { items: [], next_cursor: null, has_more: false };
    else if (path.endsWith('/api/notifications')) body = { items: [], next_cursor: null, has_more: false, unread_count: 0 };
    else if (path.endsWith('/api/rooms') && url.searchParams.get('paginated') === 'true') body = { items: [], next_cursor: null, has_more: false };

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function expectNoBlockingAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = result.violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious');
  expect(
    blocking,
    blocking.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`).join('\n'),
  ).toEqual([]);
}

test('login is free of critical/serious WCAG violations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  await expectNoBlockingAxeViolations(page);
});

for (const viewport of viewports) {
  for (const path of routes) {
    test(`${path} has no critical/serious WCAG violations at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedAuthenticatedShell(page);
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('#__next_error__')).toHaveCount(0);
      await expectNoBlockingAxeViolations(page);
    });
  }
}