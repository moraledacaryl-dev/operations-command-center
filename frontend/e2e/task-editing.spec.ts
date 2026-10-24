import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function setup(page: Page, role = 'owner', conflict = false) {
  const user = { id: 1, name: 'Operator', role, primary_department_id: 1,
    departments: [{ id: 1, name: 'Operations', is_primary: true }],
    capabilities: { manage_department: role !== 'staff', view_all_operations: role === 'owner' } };
  let task = { id: 71, title: 'Inspect pool filter', department_id: 1, status: 'To Do',
    priority: 'Normal', assigned_to_id: 2, note: 'Keep this note',
    due_date: '2026-10-24T17:00:00Z', updated_at: '2026-10-24T08:00:00Z', allowed_actions: ['start'] };
  const writes: Record<string, any>[] = [];
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, user);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let result: unknown = [];
    if (path === '/api/auth/me') result = user;
    else if (path === '/api/meta') result = { departments: user.departments, users: [
      { id: 2, name: 'Current colleague', role: 'staff', primary_department_id: 1, departments: [{ id: 1 }] },
      { id: 3, name: 'New colleague', role: 'staff', primary_department_id: 1, departments: [{ id: 1 }] },
      { id: 4, name: 'Other department', role: 'staff', primary_department_id: 2, departments: [{ id: 2 }] },
      { id: 5, name: 'Global manager', role: 'manager', primary_department_id: 2, departments: [{ id: 2 }] },
    ] };
    else if (path === '/api/notifications') result = { items: [], unread_count: 0, has_more: false };
    else if (path === '/api/tasks') {
      if (route.request().method() === 'POST') {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        task = { ...task, ...payload };
        result = task;
      } else result = [task];
    }
    else if (path === '/api/tasks/71') {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        if (conflict) return route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ detail: 'This record changed after you opened it. Refresh before saving.' }) });
        task = { ...task, ...payload, updated_at: '2026-10-24T08:05:00Z' };
      }
      result = task;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return writes;
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`task can be edited and reassigned with a version at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await setup(page);
    await page.goto('/tasks');
    await page.getByRole('button', { name: /Inspect pool filter/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    mkdirSync('test-results/ui-audit', { recursive: true });
    await page.screenshot({ path: `test-results/ui-audit/task-edit-before-${width}.png`, fullPage: true });
    await expect(dialog.getByRole('button', { name: 'Edit task', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Edit task', exact: true }).click();
    await expect(dialog.getByLabel('Due date', { exact: true })).toHaveValue('2026-10-25');
    await dialog.getByLabel('Task title', { exact: true }).fill('Check pool filter and valves');
    const assignee = dialog.getByRole('combobox', { name: 'Assigned to', exact: true });
    await assignee.selectOption('3');
    await expect(assignee.getByRole('option', { name: 'Other department' })).toHaveCount(0);
    await expect(assignee.getByRole('option', { name: 'Global manager' })).toHaveCount(1);
    await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('High');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.screenshot({ path: `test-results/ui-audit/task-edit-form-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Check pool filter and valves', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Edit task', exact: true })).toBeEnabled();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ title: 'Check pool filter and valves', assigned_to_id: 3,
      priority: 'High', due_date: '2026-10-24T17:00:00Z', note: 'Keep this note',
      expected_updated_at: '2026-10-24T08:00:00Z' });
    await page.screenshot({ path: `test-results/ui-audit/task-edit-after-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Check pool filter and valves/ })).toBeVisible();
  });
}

test('stale task edit keeps the draft and exposes the error inside the dialog', async ({ page }) => {
  const writes = await setup(page, 'owner', true);
  await page.goto('/tasks');
  await page.getByRole('button', { name: /Inspect pool filter/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Edit task', exact: true }).click();
  await dialog.getByLabel('Task title', { exact: true }).fill('Unsaved operator draft');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Refresh before saving');
  await expect(dialog.getByLabel('Task title', { exact: true })).toHaveValue('Unsaved operator draft');
  expect(writes).toHaveLength(1);
});

test('staff cannot see task editing controls', async ({ page }) => {
  await setup(page, 'staff');
  await page.goto('/tasks');
  await page.getByRole('button', { name: /Inspect pool filter/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit task', exact: true })).toHaveCount(0);
});

test('new task can be assigned without a second save', async ({ page }) => {
  const writes = await setup(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Assigned pool inspection');
  await page.getByRole('combobox', { name: 'Assigned to', exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: /Assigned pool inspection/ })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ title: 'Assigned pool inspection', assigned_to_id: 3, department_id: 1, status: 'To Do' });
});

test('closing a task while saving does not reopen the drawer', async ({ page }) => {
  await setup(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: /Inspect pool filter/ }).click();
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  let started = false;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/tasks/71', async route => {
    started = true;
    await gate;
    await route.fulfill({ json: { id: 71, title: 'Saved task', updated_at: '2026-10-24T08:05:00Z' } });
  });
  try {
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks');
    release();
    await refreshed;
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { release(); }
});
