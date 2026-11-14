import { expect, test } from '@playwright/test';

test('closing guest details while an update saves does not reopen them', async ({ page }) => {
  const department = { id: 4, name: 'Café' };
  const user = { id: 45, name: 'Fictional lead', role: 'supervisor', primary_department_id: 4,
    departments: [department], capabilities: { manage_department: true } };
  let matter = { id: 71, title: 'Practice guest concern', status: 'Open', issue_type: 'Room',
    urgency: 'High', allowed_actions: ['follow-up'] };
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '4');
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id + ':paused', 'true');
  }, user);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/workflow/guests/71/follow-up') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      matter = { ...matter, status: 'Follow', allowed_actions: [] };
      return route.fulfill({ status: 200, json: matter });
    }
    const body = path === '/api/guests/71' ? matter
      : path === '/api/guests' ? [matter]
      : path === '/api/rooms' ? []
      : path === '/api/meta' ? { departments: [department], users: [user] }
      : { items: [], groups: {}, counts: {}, unread_count: 0, has_more: false };
    return route.fulfill({ status: 200, json: body });
  });
  await page.goto('/guests');
  await page.getByRole('button', { name: /Practice guest concern/ }).click();
  await page.getByRole('button', { name: 'Needs follow-up' }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.waitForResponse(response => response.url().includes('/workflow/guests/71/follow-up'));
  await expect(page.locator('.ops-card-grid')).toContainText('Follow');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Practice guest concern/ }).click();
  await expect(page.getByRole('dialog').getByText('Follow', { exact: true }).first()).toBeVisible();
});
