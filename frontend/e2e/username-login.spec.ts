import { expect, test } from '@playwright/test';
import { TRAINING_LESSONS } from '../lib/interactive-training';

test('a username can be entered and submitted on the normal sign-in screen', async ({ page }) => {
  let submitted = '';
  await page.route('**/api/auth/login', async route => {
    submitted = route.request().postDataJSON().email;
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid login' }) });
  });
  await page.goto('/login');
  await page.getByLabel('Username or email').fill('ann.clarin');
  await page.getByLabel('Password').fill('Practice-only-4938!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#login-error')).toHaveText('Invalid username or password.');
  expect(submitted).toBe('ann.clarin');
});

test('the new user form accepts a username and defaults to staff', async ({ page }) => {
  await page.addInitScript(passed => {
    localStorage.setItem('cc_user', JSON.stringify({
      id: 1, name: 'Test owner', role: 'owner', primary_department_id: 1,
      departments: [{ id: 1, name: 'Management', is_primary: true }],
      capabilities: { manage_accounts: true, view_all_operations: true },
    }));
    localStorage.setItem('ho-ops-structured-course-v2:1', JSON.stringify({
      lessonId: 'orientation', stage: 'finished', question: 0, passed,
    }));
  }, TRAINING_LESSONS.map(lesson => lesson.id));
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], departments: [], counts: {}, unread_count: 0 }) }));
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await page.getByLabel('Username or email').fill('ann.clarin');
  await expect(page.getByLabel('Username or email')).toHaveValue('ann.clarin');
  await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('staff');
});
