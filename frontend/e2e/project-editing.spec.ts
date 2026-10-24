import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function setup(page: Page, manage = true, conflict = false) {
  const user = { id: 1, name: 'Operator', role: manage ? 'owner' : 'staff', primary_department_id: 1,
    departments: [{ id: 1, name: 'Operations', is_primary: true }] };
  let project = { id: 71, title: 'Pool restoration', owner_id: 2, department_id: 1, status: 'Active',
    priority: 'Normal', due_date: '2026-10-24T17:00:00Z', note: 'Preserve project notes', updated_at: '2026-10-24T08:00:00Z' };
  const writes: Record<string, any>[] = [];
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, user);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === '/api/auth/me') result = user;
    else if (path === '/api/meta') result = { departments: user.departments, users: [
      { id: 2, name: 'Current owner', role: 'staff', primary_department_id: 1 },
      { id: 3, name: 'New owner', role: 'staff', primary_department_id: 1 },
      { id: 4, name: 'Other department', role: 'staff', primary_department_id: 2 },
    ] };
    else if (path === '/api/notifications') result = { items: [], unread_count: 0, has_more: false };
    else if (path === '/api/project-workspaces/71') result = { project, can_manage: manage, can_contribute: true,
      comments: [], purchases: [], tasks: [], budget: { limit_cents: null, version: 0, planned_cents: 0,
        purchased_cents: 0, committed_cents: 0, remaining_cents: null, forecast_cents: 0, unpriced_count: 0 } };
    else if (path === '/api/projects/71') {
      const payload = route.request().postDataJSON();
      writes.push(payload);
      if (conflict) return route.fulfill({ status: 409, json: { detail: 'This record changed. Refresh before saving.' } });
      project = { ...project, ...payload, updated_at: '2026-10-24T08:05:00Z' };
      result = project;
    }
    await route.fulfill({ json: result });
  });
  return writes;
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`project details and owner can be edited at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await setup(page);
    await page.goto('/projects/71');
    await expect(page.getByRole('heading', { name: 'Pool restoration', exact: true })).toBeVisible();
    mkdirSync('test-results/ui-audit', { recursive: true });
    await page.screenshot({ path: `test-results/ui-audit/project-edit-before-${width}.png`, fullPage: true });
    const edit = page.getByRole('button', { name: 'Edit project', exact: true });
    await expect(edit).toBeVisible();
    await edit.click();
    const dialog = page.getByRole('dialog', { name: 'Edit project', exact: true });
    await expect(dialog.getByLabel('Due date', { exact: true })).toHaveValue('2026-10-25');
    await dialog.getByLabel('Project title', { exact: true }).fill('Pool deck restoration');
    await dialog.getByRole('combobox', { name: 'Owner', exact: true }).selectOption('3');
    await expect(dialog.getByRole('option', { name: 'Other department' })).toHaveCount(0);
    await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('High');
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await page.screenshot({ path: `test-results/ui-audit/project-edit-form-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Save project', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pool deck restoration', exact: true })).toBeVisible();
    await expect(edit).toBeFocused();
    expect(writes).toEqual([{ title: 'Pool deck restoration', owner_id: 3, priority: 'High',
      due_date: '2026-10-24T17:00:00Z', note: 'Preserve project notes', expected_updated_at: '2026-10-24T08:00:00Z' }]);
    await page.screenshot({ path: `test-results/ui-audit/project-edit-after-${width}.png`, fullPage: true });
  });
}

test('stale project save preserves the draft inside the editor', async ({ page }) => {
  await setup(page, true, true);
  await page.goto('/projects/71');
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project title', { exact: true }).fill('Unsaved project draft');
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Refresh before saving');
  await expect(dialog.getByLabel('Project title', { exact: true })).toHaveValue('Unsaved project draft');
});

test('staff cannot edit project core details', async ({ page }) => {
  await setup(page, false);
  await page.goto('/projects/71');
  await expect(page.getByRole('heading', { name: 'Pool restoration', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit project', exact: true })).toHaveCount(0);
});
