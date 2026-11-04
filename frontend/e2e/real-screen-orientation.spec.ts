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
  await course.getByLabel("Read the related task and check what still needs doing").check();
  await page.getByTestId('course-check-answer').click();
  await expect(course).toHaveCount(0);
  await expect(coach).toContainText('Your start page');

  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Open My Work');
  await expect(coach.getByText('Select the highlighted item to continue.', { exact: true })).toBeVisible();

  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(coach).toContainText('Read your tasks');

  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Open Notifications');
  await page.locator('a.ops-notifications').click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(coach).toContainText('Read the update');

  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Return to Today');
  await page.locator('.ops-sidebar a.ops-brand[href="/"]').click();
  await expect(page).toHaveURL('/');
  await expect(coach).toContainText('Getting around complete');
  await coach.getByRole('button', { name: 'Finish practice' }).click();
  await expect(coach).toHaveCount(0);
  await expect(page.getByTestId('course-independent-challenge')).toContainText('No arrows');
  await expect(page.getByTestId('course-independent-challenge')).toBeInViewport();
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(page.getByTestId('course-independent-challenge')).toContainText('notifications');
  await expect(page.getByTestId('course-independent-challenge')).toBeInViewport();
  await page.locator('a.ops-notifications').click();
  await expect(page.getByTestId('course-completed')).toContainText('Lesson 1 completed');

  await page.reload();
  await expect(coach).toHaveCount(0);
  await expect(page.getByTestId('course-completed')).toBeVisible();
  await page.getByTestId('course-repeat-lesson').click();
  await expect(page.getByTestId('course-lesson-title')).toContainText('Getting around Operations');
});

for (const viewport of [
  { width: 1440, height: 900 }, { width: 1280, height: 720 },
  { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 360, height: 740 },
]) {
  test(`independent directions are above the work at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // This isolated layout regression starts at the independent stage. The
    // employee walkthrough separately reaches it through the full real course.
    await page.addInitScript(user => {
      localStorage.setItem('cc_user', JSON.stringify(user));
      localStorage.setItem('cc_department_id', '41');
      localStorage.setItem('ho-ops-structured-course-v2:' + user.id, JSON.stringify({
        lessonId: 'orientation', stage: 'independent', independentStep: 0,
        question: 0, passed: [],
      }));
    }, fictional);
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [], groups: {}, counts: {}, unread_count: 0 }),
    }));
    await page.goto('/');
    const directions = page.getByTestId('course-independent-challenge');
    await expect(directions).toContainText('Find your own tasks');
    await expect(directions).toBeInViewport({ ratio: 0.9 });
    await expect(directions.getByRole('button', { name: 'Open the right screen' })).toBeInViewport();
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', viewport.width);
  });
}
