import { test, expect } from '@playwright/test';
import { availableTrainingLessons } from '../lib/interactive-training';

type Role = 'front' | 'cleaner' | 'other' | 'lead';
const exampleRoom = { room_area_id: 31, room_name: 'Solace' };
const labels = [
  'Change sheets and pillowcases',
  'Clean and disinfect bathroom',
  'Replace towels and toiletries',
  'Wipe tables, switches and touch points',
  'Sweep and mop or vacuum',
  'Empty bins',
  'Refill water and room supplies',
  'Check lights, air conditioner and other equipment',
  'Check for guest belongings and report to Front Desk',
  'Lock room and report anything damaged',
];
const keys = ['linen','bathroom','towels','surfaces','floor','bins','supplies','equipment','belongings','final'];

function fakeUser(role: Role) {
  const dept = role === 'front' ? 'Front Desk' : 'Housekeeping';
  const id = role === 'front' ? 401 : role === 'cleaner' ? 402 : role === 'other' ? 403 : 404;
  return { id, name: 'Fictional ' + role, role: role === 'lead' ? 'lead' : 'staff',
    email: role + '@training.invalid', departments: [{ id: role === 'front' ? 41 : 42, name: dept, is_primary: true }],
    department_id: role === 'front' ? 41 : 42, primary_department_id: role === 'front' ? 41 : 42,
    capabilities: { manage_department: role === 'lead', view_all_operations: false } };
}

function fakeBoard(role: Role, hasRecord: boolean, status: string, checked: string[] = []) {
  return { date: '2026-11-04', can_schedule: role === 'front', can_clean: role !== 'front',
    can_inspect: role === 'lead', rooms: [{
      ...exampleRoom, id: hasRecord ? 17 : null,
      service_date: '2026-11-04', status,
      source: hasRecord ? 'manual' : null,
      vacated_confirmed: status !== 'Needs cleaning' && status !== 'No cleaning request',
      started_by_id: status === 'Cleaning' ? 402 : 402,
      checklist: hasRecord ? keys.map((key, i) => ({ key, label: labels[i], checked: checked.includes(key) })) : [],
    }] };
}

async function visit(page: import('@playwright/test').Page, role: Role, response: () => ReturnType<typeof fakeBoard>) {
  const user = fakeUser(role);
  // These feature tests run with fictional employees who completed their role's
  // introductory training. The required-course suite tests incomplete learners.
  const lessonIds = availableTrainingLessons(user.capabilities, user.departments).map(lesson => lesson.id);
  await page.addInitScript(({ account, completed }) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', String(account.department_id));
    localStorage.setItem('ho-ops-structured-course-v2:' + String(account.id), JSON.stringify({
      lessonId: completed[completed.length - 1] || 'orientation',
      stage: 'finished', question: 0, passed: completed,
    }));
  }, { account: user, completed: lessonIds });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/housekeeping/turnovers' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response()) });
    }
    if (url.pathname.startsWith('/api/housekeeping/') && route.request().method() !== 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 17 }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: [], unread_count: 0, counts: {} }) });
  });
  await page.goto('/housekeeping');
  await page.getByLabel('Cleaning date').fill('2026-11-04');
}

test('front desk sees room and cannot start cleaning without checkout verification', async ({ page }) => {
  await visit(page, 'front', () => fakeBoard('front', false, 'No cleaning request'));
  await expect(page.getByRole('heading', { name: 'Room cleaning' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Solace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schedule cleaning' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start cleaning' })).toHaveCount(0);
  await expect(page.getByText(/Beds24|Accounting|automatic room updates|integration/i)).toHaveCount(0);
});

test('housekeeping sees personal checklist, review gate and mobile controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let snapshot = fakeBoard('cleaner', true, 'Cleaning', ['linen']);
  await visit(page, 'cleaner', () => snapshot);
  const card = page.getByTestId('cleaning-room-31');
  await expect(card).toContainText('Cleaning in progress');
  await expect(card).toContainText('1 of 10 finished');
  await expect(card.getByLabel(labels[0])).toBeChecked();
  await expect(card.getByLabel(labels[1])).toBeEnabled();
  await expect(card.getByRole('button', { name: 'Send for inspection' })).toBeDisabled();
  snapshot = fakeBoard('cleaner', true, 'For inspection', keys);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(card).toContainText('Waiting for inspection');
  await expect(card.getByRole('button', { name: 'Approve cleaning' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});


test('staff see the next action without system details or false vacancy', async ({ page }) => {
  await visit(page, 'front', () => ({ ...fakeBoard('front', true, 'Needs cleaning'),
    accounting_connected: true,
    rooms: [{ ...fakeBoard('front', true, 'Needs cleaning').rooms[0], source: 'accounting',
      booking_updates: [{ status: 'confirmed', origin: 'beds24', check_in: '2026-11-02', check_out: '2026-11-04', reported_at: '2026-11-03T10:00:00Z' }] }],
  }));
  const card = page.getByTestId('cleaning-room-31');
  await expect(card).toContainText('Guest status');
  await expect(card).toContainText(/not confirmed|Not available for this date/i);
  await expect(card).toContainText('Waiting for Front Desk');
  await expect(page.getByText(/Beds24|Accounting|Last received|mapped|integration/i)).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Start cleaning' })).toHaveCount(0);
});
