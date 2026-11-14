import { expect, test } from '@playwright/test';

test('a delayed click from the previous page cannot move the guided tour backwards', async ({ page }) => {
  const user = { id: 92811, name: 'Fictional staff', role: 'staff', email: 'staff@training.invalid',
    departments: [{ id: 41, name: 'Front Desk', is_primary: true }], primary_department_id: 41,
    capabilities: { manage_department: false } };
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, user);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const value = path.includes('/staff-guide/') ? [] : { groups: {}, counts: {}, items: [], unread_count: 0 };
    return route.fulfill({ status: 200, json: value });
  });
  await page.goto('/');
  const course = page.getByTestId('required-training-course');
  await page.getByTestId('course-start-quiz').click();
  await course.getByLabel('My Work', { exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await course.getByLabel('Read the related task and check what still needs doing').check();
  await page.getByTestId('course-check-answer').click();
  const coach = page.locator('.ops-guide-tip');
  await coach.getByRole('button', { name: /Next/ }).click();
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(coach).toContainText('Read your tasks');
  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Open Notifications');
  await page.locator('a.ops-notifications').click();
  await expect(coach).toContainText('Read the update');
  // The previous implementation delayed its click callback by 100 ms.
  await page.waitForTimeout(250);
  await expect(coach).toContainText('Read the update');
  await expect(page).toHaveURL(/\/notifications$/);
});

test('the Rooms lesson points to Guest rooms and advances when that filter is selected', async ({ page }) => {
  const user = { id: 92812, name: 'Fictional security staff', role: 'staff', email: 'guard@training.invalid',
    departments: [{ id: 47, name: 'Security', is_primary: true }], primary_department_id: 47,
    capabilities: { manage_department: false } };
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '47');
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id, JSON.stringify({
      lessonId: 'staff-rooms', stage: 'quiz', question: 1, passed: ['orientation', 'staff-handover'],
    }));
  }, user);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    let value: unknown = { groups: {}, counts: {}, items: [], unread_count: 0, has_more: false };
    if (path === '/api/rooms') value = { items: [{ id: 1, name: 'Solace', kind: 'room' }], has_more: false };
    return route.fulfill({ status: 200, json: value });
  });
  await page.goto('/');
  await page.getByTestId('required-training-course').getByLabel('To send the right team to the correct place').check();
  await page.getByTestId('course-check-answer').click();
  const coach = page.locator('.ops-guide-tip');
  await expect(coach).toContainText('Choose guest rooms');
  await page.getByRole('button', { name: 'Guest rooms', exact: true }).click();
  await expect(coach).toContainText('Find a room');
});
