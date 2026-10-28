import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const staff = {
  id: 7101, name: 'Fictional Staff', email: 'reception-am@training.invalid',
  role: 'staff', is_active: true,
  primary_department_id: 41,
  departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  capabilities: { manage_department: false, make_decisions: false },
};

test('ordinary staff mark an actual fictional notification read and verify saved state', async ({ page }) => {
  const title = '[TRAINING] Daily notice practice 1/2';
  let readAt: string | null = null;
  let mutations = 0;
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, staff);
  await page.context().route('**/api/**', route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const respond = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/notifications' && req.method() === 'GET') {
      return respond({ items: [{
        id: 501, kind: 'training_practice_read', title,
        body: 'Read this fictional staff update.', priority: 'Normal',
        read_at: readAt, action_url: null, created_at: '2026-10-28T00:00:00Z',
      }], next_cursor: null, unread_count: readAt ? 0 : 1 });
    }
    if (path === '/notifications/501/read' && req.method() === 'POST') {
      mutations += 1;
      readAt = '2026-10-29T00:00:00Z';
      return respond({ id: 501, read_at: readAt });
    }
    if (req.method() !== 'GET') {
      mutations += 1;
      return respond({ detail: 'Other staff writes denied' }, 403);
    }
    return respond({ counts: {}, items: [], unread_count: 0 });
  });
  await page.goto('/training');
  await expect(page.getByTestId('notification-practice')).toBeVisible();
  await page.getByTestId('notification-practice-start').click();
  await expect(page.getByTestId('notification-practice-title')).toHaveText(title);
  await page.getByTestId('notification-practice-check').click();
  await expect(page.getByTestId('notification-practice-feedback')).toContainText('still unread');
  await expect(page.getByTestId('notification-practice')).not.toContainText('Previously verified');

  const pendingPopup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Notifications in a separate tab' }).click();
  const tab = await pendingPopup;
  await expect(tab.getByText(title)).toBeVisible();
  await tab.getByRole('button', { name: 'Mark read' }).click();
  await expect(tab.getByText('You’re up to date')).toBeVisible();
  await tab.close();

  await page.getByTestId('notification-practice-check').click();
  await expect(page.getByTestId('notification-practice-feedback')).toContainText('Verified');
  await expect(page.getByTestId('notification-practice')).toContainText('Previously verified');
  expect(mutations).toBe(1);
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my results (CSV)' }).click();
  const file = await (await downloadPending).path();
  const csv = readFileSync(file!, 'utf8');
  expect(csv).toContain('"staff-notification-read","notification-mark-read","Personal"');
  expect(csv).toContain('"501"');

  await page.reload();
  await expect(page.getByTestId('notification-practice')).toContainText('Previously verified');
});

test('a staff account without accessible fictional unread notices cannot claim verification', async ({ page }) => {
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, staff);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(new URL(route.request().url()).pathname === '/api/notifications'
      ? { items: [], next_cursor: null, unread_count: 0 }
      : { counts: {}, items: [] }),
  }));
  await page.goto('/training');
  await page.getByTestId('notification-practice-start').click();
  await expect(page.getByTestId('notification-practice-feedback')).toContainText('No unread fictional practice notice');
  await expect(page.getByTestId('notification-practice')).not.toContainText('Previously verified');
});
