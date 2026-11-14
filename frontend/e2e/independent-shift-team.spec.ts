import { expect, test } from '@playwright/test';

test('a multi-team employee can find the shift challenge and recover after switching teams', async ({ page }) => {
  const user = { id: 71048, name: 'Demo bartender', role: 'staff', email: 'bartender@training.invalid',
    departments: [{ id: 48, name: 'Bar', is_primary: true }, { id: 44, name: 'Kitchen' }],
    primary_department_id: 48, capabilities: { manage_department: false } };
  const task = { id: 7, title: '[TRAINING] SHIFT-BAR-01 — Low mocktail syrup before the next shift', department_id: 48, assigned_to_id: user.id };
  const note = { id: 8, title: '[TRAINING] SHIFT-BAR-01 — shift handover', department_id: 48,
    status: 'Follow', shift: 'Night', urgency: 'Urgent', note: 'Fictional Bar handover.' };
  const notice = { id: 9, title: '[TRAINING] SHIFT-BAR-01 — shift notice', kind: 'Shift notice', user_id: user.id };
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '44');
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id, JSON.stringify({
      lessonId: 'orientation', stage: 'finished', question: 0,
      passed: ['orientation', 'staff-handover', 'staff-rooms', 'staff-my-work', 'bar'],
    }));
  }, user);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    let result: unknown = { counts: {}, items: [], next_cursor: null, has_more: false, unread_count: 0 };
    if (url.pathname === '/api/tasks') result = { items: [task], next_cursor: null, has_more: false };
    if (url.pathname === '/api/shift-notes') result = { items: url.searchParams.get('department_id') === '48' ? [note] : [], next_cursor: null, has_more: false };
    if (url.pathname === '/api/notifications') result = { items: [notice], next_cursor: null, has_more: false, unread_count: 1 };
    return route.fulfill({ status: 200, json: result });
  });
  await page.goto('/training/shift-challenge');
  await expect(page.getByTestId('independent-shift-challenge')).toContainText("We'll open the Bar team");
  await page.getByRole('button', { name: 'Start shift challenge' }).click();
  await expect(page.locator('.ops-workspace-picker select')).toHaveValue('48');
  await page.locator('.ops-workspace-picker select').selectOption('44');
  await expect(page.getByTestId('independent-shift-challenge')).toContainText('This practice uses Bar');
  await page.getByRole('button', { name: 'Switch to Bar' }).click();
  await expect(page.locator('.ops-workspace-picker select')).toHaveValue('48');
  await page.getByText('Need help finding the screens?').click();
  await page.getByRole('link', { name: 'Open Shift Handover' }).click();
  await expect(page.getByRole('button', { name: /SHIFT-BAR-01 — shift handover/ })).toBeVisible();
  await page.locator('.ops-workspace-picker select').selectOption('44');
  const returnPanel = page.getByRole('complementary', { name: 'Your shift challenge' });
  await expect(returnPanel).toContainText('switch to Bar');
  await returnPanel.getByRole('button', { name: 'switch to Bar' }).click();
  await expect(page.getByRole('button', { name: /SHIFT-BAR-01 — shift handover/ })).toBeVisible();
});
