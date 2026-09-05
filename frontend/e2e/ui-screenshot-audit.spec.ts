import { mkdirSync } from 'node:fs';
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

const captures = [
  { name: 'marketing-desktop', path: '/posts', width: 1440, height: 900 },
  { name: 'annotation-desktop', path: '/posts/editor', width: 1440, height: 900 },
  { name: 'marketing-mobile', path: '/posts', width: 390, height: 844 },
  { name: 'annotation-mobile', path: '/posts/editor', width: 390, height: 844 },
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
    else if (path.endsWith('/api/meta')) body = { departments };
    else if (path.endsWith('/api/users')) body = [owner];
    else if (path.endsWith('/api/users/page')) body = { items: [owner], next_cursor: null, has_more: false };
    else if (path.endsWith('/api/history/search/all')) body = { items: [], next_cursor: null, has_more: false };
    else if (path.endsWith('/api/notifications')) body = { items: [], next_cursor: null, has_more: false, unread_count: 0 };

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.beforeAll(() => {
  mkdirSync('test-results/ui-audit', { recursive: true });
});

for (const capture of captures) {
  test(`capture ${capture.name}`, async ({ page }) => {
    await page.setViewportSize({ width: capture.width, height: capture.height });
    await seedAuthenticatedShell(page);
    await page.goto(capture.path);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('#__next_error__')).toHaveCount(0);
    await page.screenshot({
      path: `test-results/ui-audit/${capture.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  });
}
