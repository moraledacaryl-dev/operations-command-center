import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test.use({ timezoneId: 'UTC' });

const localNow = new Date('2026-10-22T08:00:00Z'); // 4 PM Asia/Manila
const user = {
  id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner',
  department_id: 1, primary_department_id: 1,
  departments: [{ id: 1, name: 'Front Office', is_primary: true }],
  capabilities: { view_all_operations: true, manage_department: true },
};

const tasks = [
  { id: 61, title: 'Yesterday Manila', status: 'Doing', priority: 'Normal', project_id: 10, department_id: 1, due_date: '2026-10-21T15:30:00Z' }, // Oct 21 23:30
  { id: 62, title: 'Today just after midnight', status: 'Doing', priority: 'Normal', project_id: 10, department_id: 1, due_date: '2026-10-21T16:30:00Z' }, // Oct 22 00:30
  { id: 63, title: 'Today date only', status: 'To Do', priority: 'Normal', project_id: 11, department_id: 1, due_date: '2026-10-22' },
  { id: 64, title: 'Tomorrow Manila', status: 'To Do', priority: 'Normal', project_id: 11, department_id: 1, due_date: '2026-10-22T16:30:00Z' }, // Oct 23 00:30
];

const projects = [
  { id: 10, title: 'One late project', status: 'Active', priority: 'Normal', department_id: 1 },
  { id: 11, title: 'On-time project', status: 'Active', priority: 'Normal', department_id: 1 },
];

async function mock(page: Page) {
  await page.clock.install({ time: localNow });
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, user);
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (pathname === '/api/auth/me') body = user;
    else if (pathname === '/api/meta') body = { departments: user.departments, users: [] };
    else if (pathname === '/api/notifications') body = { items: [], unread_count: 0, next_cursor: null };
    else if (pathname === '/api/tasks') body = tasks;
    else if (pathname === '/api/tasks/page') body = { items: tasks, next_cursor: null, has_more: false };
    else if (pathname === '/api/projects') body = projects;
    else if (pathname === '/api/projects/page') body = { items: projects, next_cursor: null, has_more: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('Tasks overdue stat uses Manila date, not an elapsed timestamp', async ({ page }) => {
  await mock(page);
  await page.goto('/tasks');
  await expect(page.locator('.ops-stat').filter({ hasText: 'Overdue' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.ops-stat').filter({ hasText: 'Active tasks' }).locator('strong')).toHaveText('4');
  await expect(page.getByText('Oct 23, 2026')).toBeVisible(); // Manila due date, even in a UTC browser

  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/tasks-property-calendar-overdue.png', fullPage: true });
});

test('Projects risk counts agree with My Work property-date semantics', async ({ page }) => {
  await mock(page);
  await page.goto('/projects');
  await expect(page.locator('.ops-stat').filter({ hasText: 'Paused or overdue' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.ops-project-card').filter({ hasText: 'One late project' })).toContainText('1 overdue task');
  await expect(page.locator('.ops-project-card').filter({ hasText: 'On-time project' })).not.toContainText('overdue task');

  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/projects-property-calendar-overdue.png', fullPage: true });
});
