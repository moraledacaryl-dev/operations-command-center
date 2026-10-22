import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ timezoneId: 'UTC' });

const user = {
  id: 1, name: 'Owner', role: 'owner', primary_department_id: 1,
  departments: [{ id: 1, name: 'Operations', is_primary: true }],
  capabilities: { view_all_operations: true, manage_department: true, make_decisions: true },
};

const projects = [
  { id: 101, title: 'Pool deck restoration', status: 'Active', priority: 'High', department_id: 1, allowed_actions: [] },
  { id: 102, title: 'Reception refresh', status: 'Active', priority: 'Normal', department_id: 1, allowed_actions: [] },
  { id: 103, title: 'Withdrawn old task', status: 'Active', priority: 'Normal', department_id: 1, allowed_actions: [] },
];

const tasks = [
  { id: 201, title: 'Finished tile installation', project_id: 101, status: 'Done', hidden_from_active: true, priority: 'Normal', department_id: 1, due_date: '2026-10-20T04:00:00Z' },
  { id: 202, title: 'Finish sealing', project_id: 101, status: 'Doing', hidden_from_active: false, priority: 'Normal', department_id: 1, due_date: '2026-10-30T04:00:00Z' },
  { id: 203, title: 'Finished reception repaint', project_id: 102, status: 'Done', hidden_from_active: true, priority: 'Normal', department_id: 1, due_date: '2026-10-19T04:00:00Z' },
  { id: 204, title: 'Archived incomplete estimate', project_id: 103, status: 'To Do', hidden_from_active: true, priority: 'Normal', department_id: 1, due_date: '2026-10-01T04:00:00Z' },
];

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-10-22T08:00:00Z') });
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, user);

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let result: unknown = [];
    if (path === '/api/auth/me') result = user;
    else if (path === '/api/meta') result = { departments: user.departments, users: [] };
    else if (path === '/api/notifications') result = { items: [], unread_count: 0, next_cursor: null };
    else if (path === '/api/projects') result = projects;
    else if (path === '/api/tasks') {
      // Match production filtering: active=true excludes archived rows.
      const returned = url.searchParams.get('active') === 'false'
        ? tasks : tasks.filter(item => !item.hidden_from_active);
      result = returned;
    }
    else if (path === '/api/projects/101') result = projects[0];
    else if (url.searchParams.get('paginated') === 'true') result = { items: [], has_more: false, next_cursor: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`project progress survives 24-hour auto-archive at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await page.goto('/projects');

    const pool = page.locator('.ops-project-card').filter({ hasText: 'Pool deck restoration' });
    const reception = page.locator('.ops-project-card').filter({ hasText: 'Reception refresh' });
    const withdrawn = page.locator('.ops-project-card').filter({ hasText: 'Withdrawn old task' });

    await expect(pool.locator('.ops-progress-label b')).toHaveText('50%');
    await expect(pool).toContainText('1 of 2 tasks done');
    await expect(reception.locator('.ops-progress-label b')).toHaveText('100%');
    await expect(withdrawn).not.toContainText('overdue task');
    await expect(page.locator('.ops-stat').filter({ hasText: 'Paused or overdue' }).locator('strong')).toHaveText('0');

    mkdirSync('test-results/ui-audit', { recursive: true });
    await page.screenshot({ path: `test-results/ui-audit/project-archived-progress-${viewport.name}.png`, fullPage: true });

    // Portfolio detail must show historical completion rather than losing it.
    await page.goto('/projects?project=101');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Finished tile installation')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Archived', { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/ui-audit/project-archived-detail-${viewport.name}.png`, fullPage: true });
  });
}
