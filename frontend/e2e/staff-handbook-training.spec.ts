import { expect, test, type Page } from '@playwright/test';

const employee = {
  id: 9311, name: 'Demo handbook trainee', role: 'staff', is_active: true,
  departments: [{ id: 11, name: 'Café' }],
  capabilities: { manage_department: false, make_decisions: false, view_all_operations: false },
};

async function setup(page: Page) {
  await page.addInitScript(person => {
    localStorage.setItem('cc_user', JSON.stringify(person));
    localStorage.setItem('ho-ops-real-screens-intro-v1:' + person.id, 'started');
    localStorage.setItem('ho-ops-structured-course-v2:' + person.id, JSON.stringify({
      lessonId: 'orientation', stage: 'finished', question: 0,
      passed: 'orientation staff-handover staff-rooms staff-my-work team-tasks guest-matters maintenance requests shift-writing projects bar marketing management-review accounts'.split(' '),
    }));
  }, employee);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let response: unknown = {};
    if (path === '/api/auth/me') response = employee;
    else if (path === '/api/meta') response = { departments: employee.departments };
    else if (path === '/api/notifications') response = { items: [], unread_count: 0 };
    else if (path === '/api/staff-guide' || path === '/api/staff-guide/mine' || path === '/api/staff-guide/manage') response = [];
    await route.fulfill({ status: 200, json: response });
  });
}

async function answerQuestions(page: Page) {
  await page.getByRole('button', { name: 'Next: Answer three questions' }).click();
  await page.getByRole('radio', { name: /In Staff Guide, under Available guides or My Reading/ }).check();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.getByRole('radio', { name: /Search for “lateness”/ }).check();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.getByRole('radio', { name: /Only after reading the official version/ }).check();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await expect(page.getByTestId('handbook-training-practice')).toBeVisible();
}

test('staff learn, answer questions and practise searching, contents and confirmation without writes', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method());
  });
  await setup(page);
  await page.goto('/staff-guide?practice=handbook');
  await expect(page.getByTestId('handbook-training')).toBeVisible();
  await expect(page.getByText('This lesson uses a short practice copy.')).toBeVisible();

  await page.getByRole('button', { name: 'Next: Answer three questions' }).click();
  await page.getByRole('radio', { name: /In the payroll deductions screen/ }).check();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await expect(page.getByRole('alert')).toContainText('Not yet');
  await page.getByRole('radio', { name: /In Staff Guide, under Available guides or My Reading/ }).check();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.getByRole('radio', { name: /Search for “lateness”/ }).check();
  await page.getByRole('button', { name: 'Check my answer' }).click();
  await page.getByRole('radio', { name: /Only after reading the official version/ }).check();
  await page.getByRole('button', { name: 'Check my answer' }).click();

  await expect(page.getByTestId('handbook-training-instruction')).toContainText('Step 1 of 3');
  await expect(page.getByTestId('handbook-training-confirm')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search inside this handbook' }).fill('lateness');
  await expect(page.getByText('1 topic found')).toBeVisible();
  await page.locator('[class*="resultList"] button').filter({ hasText: '3.4 Lateness Policy' }).click();
  await expect(page.getByTestId('handbook-training-instruction')).toContainText('Step 2 of 3');
  await page.getByRole('navigation', { name: 'Handbook table of contents' })
    .getByRole('button', { name: '9. Safety, Security, and Emergency Procedures' }).click();
  await expect(page.getByTestId('handbook-training-instruction')).toContainText('Step 3 of 3');
  await page.getByTestId('handbook-training-confirm').click();
  await expect(page.getByTestId('handbook-training-done')).toBeVisible();
  await expect(page.getByTestId('handbook-training-done')).toContainText('not the real handbook acknowledgment');
  expect(writes).toEqual([]);
  const saved = await page.evaluate(() => localStorage.getItem('ho-ops-handbook-training-v1:9311'));
  expect(saved).toBe('completed');
});

test('the mobile contents drawer is usable during handbook practice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/staff-guide?practice=handbook');
  await answerQuestions(page);
  await page.getByRole('searchbox', { name: 'Search inside this handbook' }).fill('lateness');
  await page.locator('[class*="resultList"] button').filter({ hasText: '3.4 Lateness Policy' }).click();
  await page.getByRole('button', { name: /Contents · Jump to a section/ }).click();
  await page.getByRole('navigation', { name: 'Handbook table of contents' })
    .getByRole('button', { name: '9. Safety, Security, and Emergency Procedures' }).click();
  await expect(page.getByTestId('handbook-training-confirm')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('staff training works before the real handbook is published', async ({ page }) => {
  await setup(page);
  await page.goto('/staff-guide');
  await expect(page.getByText('No published guides match your search yet.')).toBeVisible();
  await page.getByTestId('start-handbook-training').click();
  await expect(page.getByRole('heading', { name: 'How to use the staff handbook' })).toBeVisible();
  await expect(page.getByTestId('handbook-training')).toContainText('short practice copy');
});
