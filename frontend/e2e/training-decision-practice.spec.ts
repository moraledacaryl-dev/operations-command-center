import { expect, test } from '@playwright/test';
import { TRAINING_LESSONS } from '../lib/interactive-training';

for (const scenario of [
  { lesson: 'marketing', title: 'Preparing a marketing post', wrong: 'Only the area that appears first',
    right: 'Café and Bar', feedback: 'Choose both Café and Bar', question: 'A drinks event covers Café and Bar.' },
  { lesson: 'management-review', title: 'Review and approval decisions', wrong: 'Approve and estimate the cost later',
    right: 'Ask the requester for the price and leave it pending', feedback: 'Ask for the missing price', question: '' },
]) test(`${scenario.title}: explain a wrong decision and allow the learner to correct it`, async ({ page }) => {
  const user = { id: 94250, name: 'Fictional manager', role: 'manager', primary_department_id: 46,
    departments: [{ id: 46, name: 'Marketing', is_primary: true }],
    capabilities: { manage_department: true, make_decisions: true, view_all_operations: true } };
  const passed = TRAINING_LESSONS.slice(0, TRAINING_LESSONS.findIndex(item => item.id === scenario.lesson)).map(item => item.id);
  await page.addInitScript(({ account, finished, lesson }) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', String(account.primary_department_id));
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id, JSON.stringify({ lessonId: lesson, stage: 'learn', question: 0, passed: finished }));
  }, { account: user, finished: passed, lesson: scenario.lesson });
  await page.route('**/api/**', route => route.fulfill({ status: 200,
    json: { items: [], groups: {}, counts: {}, users: [], departments: [user.departments[0]], unread_count: 0 } }));
  await page.goto('/');
  await expect(page.getByTestId('course-lesson-title')).toHaveText(scenario.title);
  const branch = page.getByTestId('course-situation-branch');
  await branch.getByLabel(scenario.wrong).check();
  await branch.getByRole('button', { name: 'Check this answer' }).click();
  await expect(branch.getByRole('status')).toContainText('Think again');
  await expect(branch.getByRole('status')).toContainText(scenario.feedback);
  await branch.getByLabel(scenario.right, { exact: true }).check();
  await branch.getByRole('button', { name: 'Check this answer' }).click();
  await expect(branch.getByRole('status')).toContainText('Good thinking');
  await page.getByTestId('course-start-quiz').click();
  await expect(page.getByTestId('course-quiz-question')).toBeVisible();
});

test('the independent Marketing check only advances when Pool is selected', async ({ page }) => {
  const user = { id: 94251, name: 'Fictional marketer', role: 'lead', primary_department_id: 46,
    departments: [{ id: 46, name: 'Marketing', is_primary: true }],
    capabilities: { manage_department: true, make_decisions: false, view_all_operations: false } };
  const passed = TRAINING_LESSONS.slice(0, TRAINING_LESSONS.findIndex(item => item.id === 'marketing')).map(item => item.id);
  await page.addInitScript(({ account, finished }) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '46');
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id, JSON.stringify({
      lessonId: 'marketing', stage: 'independent', independentStep: 0, question: 0, passed: finished,
    }));
  }, { account: user, finished: passed });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ status: 200, json: path.startsWith('/api/marketing/') ? []
      : path === '/api/meta' ? { users: [user], departments: user.departments }
      : { items: [], groups: {}, counts: {}, unread_count: 0 } });
  });
  await page.goto('/posts');
  const guide = page.getByTestId('course-independent-challenge');
  await expect(guide).toContainText('1 of 2');
  const filter = page.getByLabel('Filter Marketing by area');
  await filter.selectOption('Café');
  await expect(guide).toContainText('1 of 2');
  await filter.selectOption('Pool');
  await expect(guide).toContainText('2 of 2');
});
