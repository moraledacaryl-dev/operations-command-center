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
  await expect(coach).toContainText('You are on the real training dashboard');

  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Find My Work in the actual navigation');
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
  await coach.getByRole('button', { name: 'Finish lesson' }).click();
  await expect(coach).toHaveCount(0);

  await page.reload();
  await expect(coach).toHaveCount(0);
  await page.getByTestId('interactive-training-open').click();
  await page.getByRole('button', { name: /Getting around Operations/ }).click();
  await expect(coach).toContainText('You are on the real training dashboard');
});
