import { expect, test, type Page } from '@playwright/test';
import { TRAINING_LESSONS } from '../lib/interactive-training';

type Department = { id: number; name: string; is_primary?: boolean };
const cafe = { id: 9, name: 'Café', is_primary: true };
const kitchen = { id: 10, name: 'Kitchen' };
const bar = { id: 8, name: 'Bar' };
async function setup(page: Page, departments: Department[], global = false) {
  const user = { id: 501, name: 'Demo employee', role: global ? 'manager' : 'staff', is_active: true,
    primary_department_id: departments[0]?.id, departments,
    capabilities: { manage_department: global, make_decisions: global, view_all_operations: global } };
  const available = global ? [cafe, kitchen, bar] : departments;
  await page.addInitScript(({ account, passed }) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', String(account.primary_department_id));
    localStorage.setItem('ho-ops-structured-course-v2:501', JSON.stringify({ lessonId: 'orientation', stage: 'finished', question: 0, passed }));
  }, { account: user, passed: TRAINING_LESSONS.map(lesson => lesson.id) });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/api/auth/me') data = user;
    else if (url.pathname === '/api/meta') data = { users: [user], departments: available };
    else if (url.pathname === '/api/notifications') data = { items: [], unread_count: 0, has_more: false };
    else if (/^\/api\/departments\/\d+\/workspace$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/')[3]);
      const department = available.find(item => item.id === id);
      if (!department) return route.fulfill({ status: 403, json: { detail: 'No access to this department' } });
      data = { department, people: [user], tasks: [{ id, title: `${department.name} task`, status: 'To Do' }], requests: [], projects: [], shift: [], talk: [], docs: [], routines: [], aggregate_counts: { tasks: 1 } };
    } else if (url.pathname.endsWith('/page')) data = { items: [], has_more: false, next_cursor: null };
    return route.fulfill({ status: 200, json: data });
  });
}

test('staff see only their own food and drink team link', async ({ page }) => {
  await setup(page, [kitchen]);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Kitchen', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Café', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Bar', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Kitchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen', exact: true })).toBeVisible();
  await expect(page.getByText('Kitchen task')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View tasks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New task' })).toHaveCount(0);
});

test('staff with Café, Kitchen and Bar access can switch without mixing team work', async ({ page }) => {
  await setup(page, [cafe, kitchen, bar]);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const name of ['Café', 'Kitchen', 'Bar']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Café', exact: true }).click();
  await expect(page.getByText('Café task')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Café', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Kitchen', exact: true }).click();
  await expect(page.getByText('Kitchen task')).toBeVisible();
  await expect(page.getByText('Café task')).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Kitchen', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Bar', exact: true }).click();
  await expect(page.getByTestId('bar-workspace')).toBeVisible();
});

test('managers with property-wide access can find all three areas', async ({ page }) => {
  await setup(page, [{ id: 1, name: 'Management', is_primary: true }], true);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const name of ['Café', 'Kitchen', 'Bar']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Kitchen', exact: true }).click();
  await expect(page.getByText('Kitchen task')).toBeVisible();
  await expect(page.locator('.ops-workspace-picker select')).toHaveValue('10');
});


test('team links are usable in the phone menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, [cafe, kitchen]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Kitchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen', exact: true })).toBeVisible();
  await expect(page.getByText('Kitchen task')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
