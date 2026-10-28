import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const employee = {
  id: 7101, name: 'Fictional Housekeeping Staff', email: 'housekeeper-am@training.invalid',
  role: 'staff', is_active: true, primary_department_id: 41,
  departments: [{ id: 41, name: 'Housekeeping', is_primary: true }],
  capabilities: { manage_department: false, make_decisions: false },
};

test('ordinary staff inspect an actual saved fictional task without mutation permissions', async ({ page }) => {
  const saved = { id: 501, title: '[TRAINING] Confirm room readiness', department_id: 41,
    status: 'Doing', priority: 'High', assigned_to_id: 7101 };
  let detailReads = 0;
  let writes = 0;
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, employee);
  await page.context().route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    const respond = (value: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(value) });
    if (method !== 'GET') {
      writes += 1;
      return respond({ detail: 'Staff cannot write' }, 403);
    }
    if (path === '/tasks') return respond([saved]);
    if (path === '/tasks/501') { detailReads += 1; return respond(saved); }
    return respond({ counts: {}, items: [], unread_count: 0 });
  });
  await page.goto('/training');
  await expect(page.getByTestId('training-record-lookup')).toBeVisible();
  await page.getByTestId('record-lookup-start').click();
  await expect(page.getByTestId('record-lookup-title')).toHaveText(saved.title);
  await expect(page.getByRole('link', { name: 'Tasks in a separate tab' })).toHaveAttribute('href', '/tasks');
  await expect(page.getByRole('link', { name: 'Tasks in a separate tab' })).toHaveAttribute('target', '_blank');
  const popupPending = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Tasks in a separate tab' }).click();
  const taskTab = await popupPending;
  await expect(taskTab.getByTestId('tasks-board')).toBeVisible();
  await expect(taskTab.getByText(saved.title).first()).toBeVisible();
  await taskTab.getByText(saved.title).first().click();
  await expect(taskTab.getByText('No task transition is available for your role and this state.')).toBeVisible();
  await taskTab.close();

  await page.getByTestId('record-lookup-status').selectOption('To Do');
  await page.getByTestId('record-lookup-priority').selectOption('Normal');
  await page.getByTestId('record-lookup-check').click();
  await expect(page.getByTestId('record-lookup-feedback')).toContainText('do not match');
  await expect(page.getByTestId('training-record-lookup')).not.toContainText('Previously completed');

  await page.getByTestId('record-lookup-status').selectOption('Doing');
  await page.getByTestId('record-lookup-priority').selectOption('High');
  await page.getByTestId('record-lookup-check').click();
  await expect(page.getByTestId('record-lookup-feedback')).toContainText('both answers match');
  expect(detailReads).toBeGreaterThanOrEqual(2);
  expect(writes).toBe(0);
  const downloadPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my results (CSV)' }).click();
  const exported = await downloadPending;
  const file = await exported.path();
  expect(file).toBeTruthy();
  const csv = readFileSync(file!, 'utf8');
  expect(csv).toContain('"read-only-task-inspection","task-status-priority","41"');
  expect(csv).toContain('"501"');

  await page.reload();
  await expect(page.getByTestId('training-record-lookup')).toContainText('Previously completed');
  await expect(page.getByTestId('record-lookup-title')).toHaveText(saved.title);
});

test('staff task inspection handles missing department records without fake completion', async ({ page }) => {
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, employee);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(path.startsWith('/api/tasks') ? [] : { counts: {}, items: [] }) });
  });
  await page.goto('/training');
  await page.getByTestId('record-lookup-start').click();
  await expect(page.getByTestId('record-lookup-feedback')).toContainText('No accessible fictional training task');
  await expect(page.getByTestId('record-lookup-title')).toHaveCount(0);
});
