import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

for (const mobile of [false, true]) test(`Front Desk saves two real-screen stay attempts at ${mobile ? 'mobile' : 'desktop'} size`, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T03:00:00Z'));
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const user = { id: 401, name: 'Fictional Receptionist', email: 'reception-pm@training.invalid', role: 'staff',
    department_id: 41, primary_department_id: 41, capabilities: {}, departments: [{ id: 41, name: 'Front Desk', is_primary: true }] };
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
    localStorage.setItem('ho-ops-structured-course-v2:401', JSON.stringify({ lessonId: 'room-arrivals', stage: 'independent',
      question: 0, passed: ['orientation', 'staff-handover', 'staff-rooms'] }));
  }, user);
  type Stay = { id: number; checked_in_at: string; checked_out_at: string | null; checked_in_by_id: number; checked_out_by_id: number | null };
  const rooms = ['Grandeur', 'Skyroom'].map((room_name, index) => ({
    id: null, room_area_id: 31 + index, room_name, service_date: '2026-11-04', status: 'No cleaning request', source: null,
    vacated_confirmed: false, checklist: [], booking_updates: [],
    guest_stay: index === 0 ? { id: 3, checked_in_at: '2026-11-03T01:00:00Z', checked_out_at: '2026-11-03T02:00:00Z', checked_in_by_id: 401, checked_out_by_id: 401 } as Stay | null : null as Stay | null,
  }));
  let nextId = 4;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/housekeeping/turnovers') return route.fulfill({ json: { date: '2026-11-04', rooms, can_schedule: true, can_clean: false, can_inspect: false } });
    const change = path.match(/^\/api\/housekeeping\/rooms\/(\d+)\/(?:stays\/\d+\/)?(check-in|check-out)$/);
    if (change) {
      const room = rooms.find(r => r.room_area_id === Number(change[1]))!;
      if (change[2] === 'check-in') room.guest_stay = { id: nextId++, checked_in_at: '2026-11-04T03:00:00Z', checked_out_at: null, checked_in_by_id: 401, checked_out_by_id: null };
      else { room.guest_stay!.checked_out_at = '2026-11-04T04:00:00Z'; room.guest_stay!.checked_out_by_id = 401; }
      return route.fulfill({ json: room.guest_stay });
    }
    return route.fulfill({ json: { items: [], groups: {}, counts: {}, unread_count: 0 } });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/housekeeping');
  const mission = page.getByTestId('room-arrival-practice');
  await expect(mission).toContainText('Grandeur');
  for (const [index, room] of ['Grandeur', 'Skyroom'].entries()) {
    await mission.getByRole('button', { name: index === 0 ? 'Start with a guide' : 'Try the next room', exact: true }).click();
    if (index === 0) await mission.getByRole('button', { name: 'Hide arrow', exact: true }).click();
    else await expect(page.getByTestId('training-spotlight')).toHaveCount(0);
    await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
    await expect(page.getByText(/Your new check-in has not been found/)).toBeVisible();
    await expect(page.getByTestId('course-completed')).toHaveCount(0);
    await page.getByLabel('Find room', { exact: true }).fill(room);
    const card = page.locator('.hk-room-card').filter({ has: page.getByRole('heading', { name: room, exact: true }) });
    await card.getByRole('button', { name: 'Record check-in', exact: true }).click();
    await expect(card).toContainText('Checked in.');
    if (index === 0) {
      // Another employee's new record must not count as this learner's work.
      rooms[0].guest_stay!.checked_in_by_id = 402;
      await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
      await expect(page.getByText(/Your new check-in has not been found/)).toBeVisible();
      rooms[0].guest_stay!.checked_in_by_id = 401;
    }
    await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
    await expect(mission.getByRole('heading')).toHaveText('Record checkout in ' + room);
    if (index === 0) await mission.getByRole('button', { name: 'Hide arrow', exact: true }).click();
    await page.reload();
    await expect(mission.getByRole('heading')).toHaveText('Record checkout in ' + room);
    await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
    await expect(page.getByText(/Your checkout has not been found/)).toBeVisible();
    await page.getByLabel('Find room', { exact: true }).fill(room);
    await card.getByRole('button', { name: 'Record checkout', exact: true }).click();
    await expect(card).toContainText('Last checkout recorded');
    mkdirSync('test-results/ui-audit', { recursive: true });
    if (index === 1) await page.screenshot({ path: `test-results/ui-audit/interactive-training-final-room-practice-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Check saved work', exact: true }).click();
  }
  await expect(page.getByTestId('course-completed')).toBeVisible();
  await expect(page.getByTestId('required-training-course')).toContainText('The app checked your saved work.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
});
