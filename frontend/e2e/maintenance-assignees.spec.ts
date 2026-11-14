import { expect, test } from '@playwright/test';

test('maintenance assignment lists people who can see the selected team’s work', async ({ page }) => {
  const departments = [{ id: 20, name: 'Maintenance' }, { id: 30, name: 'Kitchen' }];
  const manager = { id: 1, name: 'Fictional manager', role: 'manager', primary_department_id: 20,
    departments, capabilities: { manage_department: true, view_all_operations: true } };
  const people = [manager,
    { id: 2, name: 'Maintenance colleague', role: 'staff', primary_department_id: 20, departments: [{ id: 20 }] },
    { id: 3, name: 'Kitchen colleague', role: 'staff', primary_department_id: 30, departments: [{ id: 30 }] }];
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '20');
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id + ':paused', 'true');
  }, manager);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/meta' ? { departments, users: people }
      : { items: [], groups: {}, counts: {}, unread_count: 0, has_more: false };
    return route.fulfill({ status: 200, json: body });
  });
  await page.goto('/fixes');
  await page.getByTestId('create-fix').click();
  let assignee = page.getByTestId('create-fix-form').getByRole('combobox', { name: 'Assigned technician' });
  await expect(assignee.locator('option', { hasText: 'Maintenance colleague' })).toHaveCount(1);
  await expect(assignee.locator('option', { hasText: 'Kitchen colleague' })).toHaveCount(0);
  await expect(assignee.locator('option', { hasText: 'Fictional manager' })).toHaveCount(1);
  await page.locator('.ops-workspace-picker select').selectOption('30');
  await page.getByTestId('create-fix').click();
  assignee = page.getByTestId('create-fix-form').getByRole('combobox', { name: 'Assigned technician' });
  await expect(assignee.locator('option', { hasText: 'Kitchen colleague' })).toHaveCount(1);
  await expect(assignee.locator('option', { hasText: 'Maintenance colleague' })).toHaveCount(0);
});
