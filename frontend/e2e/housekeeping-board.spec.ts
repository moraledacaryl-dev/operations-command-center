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
  await expect(page.getByText(/This page is for cleaning after checkout/)).toBeVisible();
  await expect(page.getByText(/If a guest is staying and asks for cleaning/)).toBeVisible();
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
  await expect(card).toContainText(/Not recorded|Guest status is shown for today only/i);
  await expect(card).toContainText('Waiting for Front Desk');
  await expect(page.getByText(/Beds24|Accounting|Last received|mapped|integration/i)).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Start cleaning' })).toHaveCount(0);
});

test('a recorded check-in is shown separately from cleaning and remains subject to confirmation', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T03:00:00Z'));
  await visit(page, 'front', () => ({ ...fakeBoard('front', true, 'Needs cleaning'),
    rooms: [{ ...fakeBoard('front', true, 'Needs cleaning').rooms[0],
      guest_stay: { id: 55, checked_in_at: '2026-11-04T02:00:00Z', checked_out_at: null } }],
  }));
  const card = page.getByTestId('cleaning-room-31');
  await expect(card).toContainText('Guest status');
  await expect(card).toContainText('Checked in. Do not start a checkout clean.');
  await expect(card).toContainText('Cleaning: Waiting to be cleaned');
  await expect(card.getByRole('button', { name: 'Record checkout' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Confirm guest has left' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Start cleaning' })).toHaveCount(0);
});

test('changing dates cannot show an older room list after a slower request finishes', async ({ page }) => {
  await visit(page, 'front', () => fakeBoard('front', false, 'No cleaning request'));
  let releaseOld!: () => void;
  const oldRequest = new Promise<void>(resolve => { releaseOld = resolve; });
  let oldStarted!: () => void;
  const started = new Promise<void>(resolve => { oldStarted = resolve; });
  await page.route('**/api/housekeeping/turnovers?*', async route => {
    const day = new URL(route.request().url()).searchParams.get('service_date');
    if (day === '2026-11-05') { oldStarted(); await oldRequest; }
    const board = fakeBoard('front', false, 'No cleaning request');
    board.date = day || '';
    board.rooms[0].room_name = day === '2026-11-06' ? 'Perch 1' : 'Old room';
    await route.fulfill({ status: 200, json: board });
  });
  await page.getByLabel('Cleaning date').fill('2026-11-05');
  await started;
  await expect(page.getByRole('heading', { name: 'Solace' })).toHaveCount(0);
  await page.getByLabel('Cleaning date').fill('2026-11-06');
  await expect(page.getByRole('heading', { name: 'Perch 1' })).toBeVisible();
  const lateResponse = page.waitForResponse(response => response.url().includes('service_date=2026-11-05'));
  releaseOld();
  await lateResponse;
  await expect(page.getByRole('heading', { name: 'Old room' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Perch 1' })).toBeVisible();
});

test('a failed refresh removes the old room list instead of presenting it as current', async ({ page }) => {
  await visit(page, 'front', () => fakeBoard('front', false, 'No cleaning request'));
  await expect(page.getByRole('heading', { name: 'Solace' })).toBeVisible();
  await page.route('**/api/housekeeping/turnovers?*', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('.hk-error')).toContainText('Room cleaning is unavailable');
  await expect(page.getByRole('heading', { name: 'Solace' })).toHaveCount(0);
  await expect(page.getByLabel('Cleaning progress')).toHaveCount(0);
});

test('clearing the date asks staff to choose a date without showing a room list', async ({ page }) => {
  await visit(page, 'front', () => fakeBoard('front', false, 'No cleaning request'));
  await page.getByLabel('Cleaning date').fill('');
  await expect(page.locator('.hk-error')).toHaveText('Choose a date to see rooms.');
  await expect(page.getByRole('heading', { name: 'Solace' })).toHaveCount(0);
});

test('front desk can record an arrival and departure for a room', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T03:00:00Z'));
  let snapshot = { ...fakeBoard('front', true, 'Needs cleaning'), rooms: [{
    ...fakeBoard('front', true, 'Needs cleaning').rooms[0],
    guest_stay: null as null | { id: number; checked_in_at: string; checked_out_at: string | null },
  }] };
  await visit(page, 'front', () => snapshot);
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/housekeeping/rooms/**', route => {
    if (route.request().url().endsWith('/check-in')) {
      snapshot.rooms[0].guest_stay = { id: 55, checked_in_at: '2026-11-04T03:00:00Z', checked_out_at: null };
    } else {
      snapshot.rooms[0].guest_stay = { id: 55, checked_in_at: '2026-11-04T03:00:00Z', checked_out_at: '2026-11-04T04:00:00Z' };
    }
    return route.fulfill({ status: 200, json: {} });
  });
  const card = page.getByTestId('cleaning-room-31');
  await card.getByRole('button', { name: 'Record check-in' }).click();
  await expect(card).toContainText('Checked in. Do not start a checkout clean.');
  await card.getByRole('button', { name: 'Record checkout' }).click();
  await expect(card).toContainText('Last checkout recorded');
  await expect(card.getByRole('button', { name: 'Confirm guest has left' })).toBeVisible();
});

test('a mistaken checkout can be corrected and the reason is sent', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T03:00:00Z'));
  let snapshot = { ...fakeBoard('front', true, 'Needs cleaning'), rooms: [{
    ...fakeBoard('front', true, 'Needs cleaning').rooms[0],
    guest_stay: { id: 55, checked_in_at: '2026-11-04T01:00:00Z', checked_out_at: '2026-11-04T02:00:00Z' as string | null },
  }] };
  await visit(page, 'front', () => snapshot);
  page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'Guest is still here' : undefined));
  let sentReason = '';
  await page.route('**/api/housekeeping/rooms/**/correct', route => {
    sentReason = route.request().postDataJSON().reason;
    snapshot.rooms[0].guest_stay.checked_out_at = null;
    return route.fulfill({ status: 200, json: { corrected: true } });
  });
  const card = page.getByTestId('cleaning-room-31');
  await card.getByRole('button', { name: 'Correct checkout' }).click();
  await expect(card).toContainText('Checked in. Do not start a checkout clean.');
  expect(sentReason).toBe('Guest is still here');
});

test('a later guest needs a new clean, not the old approval', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T03:00:00Z'));
  await visit(page, 'front', () => ({ ...fakeBoard('front', true, 'Cleared'), rooms: [{
    ...fakeBoard('front', true, 'Cleared').rooms[0], vacated_at: '2026-11-04T01:00:00Z',
    guest_stay: { id: 55, checked_in_at: '2026-11-04T02:00:00Z', checked_out_at: '2026-11-04T02:30:00Z' },
    needs_another_clean: true,
  }] }));
  const card = page.getByTestId('cleaning-room-31');
  await expect(card).toContainText('This cleaning was for an earlier guest');
  await expect(card.getByRole('button', { name: 'Schedule another clean' })).toBeVisible();
  await expect(card.getByText('Cleaning approved.', { exact: false })).toHaveCount(0);
});
