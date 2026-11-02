import { expect, test } from '@playwright/test';

const fictional = {
  id: 9801, name: 'Fictional Front Desk Trainee', email: 'real-screens@training.invalid',
  role: 'staff', is_active: true,
  departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  primary_department_id: 41, capabilities: {},
};

test('first training open starts on real dashboard and requires navigating actual controls', async ({ page }) => {
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '41');
  }, fictional);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], groups: {}, counts: {}, unread_count: 0 }),
  }));

  await page.goto('/');
  await expect(page.locator('.today-workspace')).toBeVisible();
  const coach = page.locator('.ops-guide-tip');
  const course = page.getByTestId('required-training-course');
  await expect(course).toContainText('Getting around Operations');
  await expect(coach).toHaveCount(0);
  await page.getByTestId('course-start-quiz').click();
  await expect(course).toContainText('Where do you go first');
  // Wrong choices do not unlock the practical page.
  await course.getByLabel('Rooms', { exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await expect(course).toContainText('Not quite.');
  await course.getByLabel('My Work', { exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await expect(course).toContainText('You read a notification');
  await course.getByLabel('Read the linked work and check what action is still needed').check();
  await page.getByTestId('course-check-answer').click();
  await expect(course).toHaveCount(0);
  await expect(coach).toContainText('You are on the practice dashboard');

  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Find My Work');
  await expect(coach.getByRole('button', { name: /Click highlighted link/ })).toBeDisabled();

  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(coach).toContainText('Review your assigned work');

  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Find notifications');
  await page.locator('a.ops-notifications').click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(coach).toContainText('Read your notifications');

  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Return to the dashboard');
  await page.locator('.ops-sidebar a.ops-brand[href="/"]').click();
  await expect(page).toHaveURL('/');
  await expect(coach).toContainText('You know your way around');
  await coach.getByRole('button', { name: 'Finish practice' }).click();
  await expect(coach).toHaveCount(0);
  await expect(page.getByTestId('course-independent-challenge')).toContainText('No arrows');
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.getByTestId('course-independent-challenge')).toContainText('notifications');
  await page.locator('a.ops-notifications').click();
  await expect(page.getByTestId('course-completed')).toContainText('Lesson 1 completed');

  await page.reload();
  await expect(coach).toHaveCount(0);
  await expect(page.getByTestId('course-completed')).toBeVisible();
  await page.getByTestId('course-repeat-lesson').click();
  await expect(page.getByTestId('course-lesson-title')).toContainText('Getting around Operations');
});
