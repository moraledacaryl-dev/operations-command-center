import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

function staff(departmentId: number, name: string, email: string) {
  return { id: 7105, name: 'Fictional ' + name + ' Employee', email,
    role: 'staff', is_active: true, primary_department_id: departmentId,
    departments: [{ id: departmentId, name, is_primary: true }],
    capabilities: { manage_department: false, make_decisions: false },
  };
}

test('front desk staff inspect a saved guest matter without editing operational records', async ({ page }) => {
  const record = { id: 901, title: '[TRAINING] Room 205 aircon not cooling',
    department_id: 41, status: 'Follow', urgency: 'Urgent', issue_type: 'Room',
    guest_name: 'Demo Guest', note: 'Fictional maintenance referral', allowed_actions: [] };
  let reads = 0;
  let writes = 0;
  await page.addInitScript(value => {
    localStorage.setItem('cc_user', JSON.stringify(value));
    localStorage.setItem('cc_department_id', '41');
  }, staff(41, 'Front Desk', 'reception-am@training.invalid'));
  await page.context().route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const respond = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (route.request().method() !== 'GET') {
      writes++;
      return respond({ detail: 'Staff writes refused' }, 403);
    }
    if (path === '/guests') return respond([record]);
    if (path === '/guests/901') { reads++; return respond(record); }
    if (['/rooms', '/tasks', '/shift-notes'].includes(path)) return respond([]);
    return respond({ counts: {}, items: [], unread_count: 0 });
  });
  await page.goto('/training');
  await expect(page.getByTestId('training-guest-lookup')).toBeVisible();
  await expect(page.getByTestId('training-fix-lookup')).toHaveCount(0);
  await page.getByTestId('guest-lookup-start').click();
  await expect(page.getByTestId('guest-lookup-title')).toHaveText(record.title);

  const opened = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Guest Matters in a separate tab' }).click();
  const tab = await opened;
  await expect(tab.getByText(record.title).first()).toBeVisible();
  await tab.getByText(record.title).first().click();
  await expect(tab.getByRole('heading', { name: 'Next action' })).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Create maintenance' })).toHaveCount(0);
  await tab.close();

  await page.getByTestId('guest-lookup-status').selectOption('Open');
  await page.getByTestId('guest-lookup-priority').selectOption('Normal');
  await page.getByTestId('guest-lookup-check').click();
  await expect(page.getByTestId('guest-lookup-feedback')).toContainText('do not match');

  await page.getByTestId('guest-lookup-status').selectOption('Follow');
  await page.getByTestId('guest-lookup-priority').selectOption('Urgent');
  await page.getByTestId('guest-lookup-check').click();
  await expect(page.getByTestId('guest-lookup-feedback')).toContainText('both answers match');
  expect(writes).toBe(0);
  expect(reads).toBeGreaterThanOrEqual(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my results (CSV)' }).click();
  const csv = readFileSync((await (await download).path())!, 'utf8');
  expect(csv).toContain('"read-only-guest-inspection","guest-status-urgency","41"');
  expect(csv).toContain('"901"');
  await page.reload();
  await expect(page.getByTestId('training-guest-lookup')).toContainText('Previously completed');
});

test('maintenance staff inspect a saved work order without verify/repair privileges', async ({ page }) => {
  const record = { id: 902, title: '[TRAINING] Room 205 maintenance ticket',
    department_id: 43, status: 'Working', urgency: 'High',
    problem: 'Fictional electrical inspection', allowed_actions: [] };
  let writes = 0;
  let reads = 0;
  await page.addInitScript(value => {
    localStorage.setItem('cc_user', JSON.stringify(value));
    localStorage.setItem('cc_department_id', '43');
  }, staff(43, 'Maintenance', 'technician@training.invalid'));
  await page.context().route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const respond = (body: unknown, code = 200) =>
      route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
    if (route.request().method() !== 'GET') {
      writes++;
      return respond({ detail: 'Staff writes refused' }, 403);
    }
    if (path === '/fixes') return respond([record]);
    if (path === '/fixes/902') { reads++; return respond(record); }
    if (['/rooms', '/tasks', '/shift-notes', '/users'].includes(path)) return respond([]);
    return respond({ counts: {}, items: [], unread_count: 0 });
  });

  await page.goto('/training');
  await expect(page.getByTestId('training-fix-lookup')).toBeVisible();
  await expect(page.getByTestId('training-guest-lookup')).toHaveCount(0);
  await page.getByTestId('fix-lookup-start').click();
  await expect(page.getByTestId('fix-lookup-title')).toHaveText(record.title);
  const pending = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Maintenance in a separate tab' }).click();
  const tab = await pending;
  await expect(tab.getByText(record.title).first()).toBeVisible();
  await tab.getByText(record.title).first().click();
  await expect(tab.getByRole('heading', { name: 'Actions' })).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
  await expect(tab.getByRole('button', { name: 'Verify' })).toHaveCount(0);
  await tab.close();

  await page.getByTestId('fix-lookup-status').selectOption('Open');
  await page.getByTestId('fix-lookup-priority').selectOption('Normal');
  await page.getByTestId('fix-lookup-check').click();
  await expect(page.getByTestId('fix-lookup-feedback')).toContainText('do not match');

  await page.getByTestId('fix-lookup-status').selectOption('Working');
  await page.getByTestId('fix-lookup-priority').selectOption('High');
  await page.getByTestId('fix-lookup-check').click();
  await expect(page.getByTestId('fix-lookup-feedback')).toContainText('both answers match');
  expect(writes).toBe(0);
  expect(reads).toBeGreaterThanOrEqual(1);
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my results (CSV)' }).click();
  const csv = readFileSync((await (await pendingDownload).path())!, 'utf8');
  expect(csv).toContain('"read-only-fix-inspection","fix-status-urgency","43"');
  expect(csv).toContain('"902"');
});
