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


test('switching the selected department discards stale task details and restores the correct bookmark', async ({ page }) => {
  const manager = { ...employee, id: 7102, role: 'manager',
    email: 'manager@training.invalid',
    capabilities: { manage_department: true, make_decisions: true },
    departments: [
      { id: 41, name: 'Housekeeping', is_primary: true },
      { id: 42, name: 'Maintenance', is_primary: false },
    ],
  };
  const first = { id: 501, title: '[TRAINING] Housekeeping checklist', department_id: 41,
    status: 'To Do', priority: 'Normal' };
  const second = { id: 502, title: '[TRAINING] Maintenance inspection', department_id: 42,
    status: 'Review', priority: 'Urgent' };
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, manager);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const body = path === '/tasks'
      ? [url.searchParams.get('department_id') === '42' ? second : first]
      : path === '/tasks/501' ? first
      : path === '/tasks/502' ? second
      : { counts: {}, items: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/training');
  await page.getByTestId('record-lookup-start').click();
  await expect(page.getByTestId('record-lookup-title')).toHaveText(first.title);
  await page.evaluate(() => {
    localStorage.setItem('cc_department_id', '42');
    window.dispatchEvent(new CustomEvent('cc:department-change', { detail: { departmentId: 42 } }));
  });
  await expect(page.getByTestId('record-lookup-title')).toHaveCount(0);
  await page.getByTestId('record-lookup-start').click();
  await expect(page.getByTestId('record-lookup-title')).toHaveText(second.title);
  await page.evaluate(() => {
    localStorage.setItem('cc_department_id', '41');
    window.dispatchEvent(new CustomEvent('cc:department-change', { detail: { departmentId: 41 } }));
  });
  await expect(page.getByTestId('record-lookup-title')).toHaveText(first.title);
});


test('staff inspect saved shift handovers in the real interface and export read-only evidence', async ({ page }) => {
  const handover = { id: 902, title: '[TRAINING] Night shift unresolved guest update',
    department_id: 41, shift: 'Night', category: 'Guest', urgency: 'Urgent',
    status: 'Follow', note: 'Fictional guest needs a callback from the receiving shift.' };
  let detailReads = 0;
  let writes = 0;
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, employee);
  await page.context().route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const respond = (value: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(value) });
    if (route.request().method() !== 'GET') {
      writes++;
      return respond({ detail: 'Staff cannot write' }, 403);
    }
    if (path === '/shift-notes') return respond([handover]);
    if (path === '/shift-notes/902') { detailReads++; return respond(handover); }
    if (path === '/tasks') return respond([]);
    return respond({ counts: {}, items: [], unread_count: 0 });
  });
  await page.goto('/training');
  await expect(page.getByTestId('training-handover-lookup')).toBeVisible();
  await page.getByTestId('handover-lookup-start').click();
  await expect(page.getByTestId('handover-lookup-title')).toHaveText(handover.title);
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Shift Handover in a separate tab' }).click();
  const shiftTab = await popup;
  await expect(shiftTab.getByText(handover.title).first()).toBeVisible();
  await shiftTab.getByText(handover.title).first().click();
  await expect(shiftTab.getByText('No handover transition is available for your role and this state.')).toBeVisible();
  await shiftTab.close();

  await page.getByTestId('handover-lookup-status').selectOption('Seen');
  await page.getByTestId('handover-lookup-priority').selectOption('Normal');
  await page.getByTestId('handover-lookup-check').click();
  await expect(page.getByTestId('handover-lookup-feedback')).toContainText('do not match');
  await page.getByTestId('handover-lookup-status').selectOption('Follow');
  await page.getByTestId('handover-lookup-priority').selectOption('Urgent');
  await page.getByTestId('handover-lookup-check').click();
  await expect(page.getByTestId('handover-lookup-feedback')).toContainText('both answers match');
  expect(detailReads).toBeGreaterThanOrEqual(2);
  expect(writes).toBe(0);

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my results (CSV)' }).click();
  const file = await (await pending).path();
  const csv = readFileSync(file!, 'utf8');
  expect(csv).toContain('"read-only-handover-inspection","handover-status-urgency","41"');
  expect(csv).toContain('"902"');
  await page.reload();
  await expect(page.getByTestId('training-handover-lookup')).toContainText('Previously completed');
});
