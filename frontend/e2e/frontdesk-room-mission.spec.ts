import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FIRST_ROOM, SECOND_ROOM, findPracticeIssue, readRoomMission } from '../lib/training-room-mission';

test('room mission progress parser ignores forged/invalid stages', () => {
  expect(readRoomMission('not-json')).toEqual({ stage: 'intro' });
  expect(readRoomMission('{"stage":"done"}')).toEqual({ stage: 'intro' });
  expect(readRoomMission('{"stage":"answer","solaceId":-1}')).toEqual({ stage: 'answer' });
  expect(findPracticeIssue({ room: { id: 6, name: 'Solace' },
    guests: [{ title: '[TRAINING] Solace AC not cooling', status: 'Follow' }] },
    FIRST_ROOM.name, FIRST_ROOM.title)).toEqual({ roomId: 6, status: 'Follow' });
  expect(findPracticeIssue({ room: { id: 6, name: 'Solace' },
    guests: [{ title: '[TRAINING] Different report', status: 'Follow' }] },
    FIRST_ROOM.name, FIRST_ROOM.title)).toBeNull();
});

test('Front Desk employee completes guided Solace and independent Perch 1 on actual Rooms screens', async ({ page }) => {
  const user = { id: 69001, name: 'Fictional Receptionist', role: 'staff', email: 'room-mission@training.invalid',
    departments: [{ id: 41, name: 'Front Desk', is_primary: true }], primary_department_id: 41,
    capabilities: { manage_department: false } };
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '41');
    localStorage.setItem('ho-ops-structured-course-v2:' + user.id, JSON.stringify({
      lessonId: 'staff-rooms', stage: 'room-practice', question: 0,
      passed: ['orientation', 'staff-handover'],
    }));
  }, user);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET')
      return route.fulfill({ status: 405, body: 'Practice does not write to the API.' });
    const rooms = [
      { id: 101, name: 'Solace', kind: 'room', status: 'active', note: 'Practice room' },
      { id: 102, name: 'Perch 1', kind: 'room', status: 'active', note: 'Practice room' },
      { id: 103, name: 'Crown', kind: 'room', status: 'active', note: 'Practice room' },
    ];
    let body: unknown = { counts: {}, items: [], next_cursor: null, unread_count: 0 };
    if (url.pathname.endsWith('/rooms')) body = { items: rooms, next_cursor: null, has_more: false };
    if (url.pathname.endsWith('/rooms/101/memory')) body = { room: rooms[0],
      guests: [{ id: 501, title: FIRST_ROOM.title, status: 'Follow', urgency: 'Urgent',
        note: 'Fictional AC concern' }], fixes: [] };
    if (url.pathname.endsWith('/rooms/102/memory')) body = { room: rooms[1],
      guests: [{ id: 502, title: SECOND_ROOM.title, status: 'Open', urgency: 'Normal',
        note: 'Fictional towel request' }], fixes: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/rooms');
  const mission = page.getByTestId('frontdesk-room-mission');
  await expect(mission).toContainText('A guest reports an AC problem in Solace');
  await mission.getByText('Show me an example').click();
  await expect(mission).toContainText('Open Rooms');
  await mission.getByRole('button', { name: 'Help me do it' }).click();
  await expect(mission).toContainText('Show guest rooms');

  await page.getByRole('button', { name: 'Guest rooms' }).click();
  await expect(mission).toContainText('Find Solace');
  await page.reload();
  await expect(mission).toContainText('Find Solace');
  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/frontdesk-solace-guided-search.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Search rooms and areas' }).fill('Solace');
  await expect(mission).toContainText('Open Solace');
  await page.getByRole('link', { name: 'Open Solace' }).click();
  await expect(page).toHaveURL(/\/rooms\/101$/);
  await expect(mission).toContainText('Read the saved guest report');
  await page.screenshot({ path: 'test-results/ui-audit/frontdesk-solace-report-check.png', fullPage: true });
  await expect(page.getByText(FIRST_ROOM.title)).toBeVisible();

  await mission.getByLabel('What status is shown on the guest report?').selectOption('Done');
  await mission.getByRole('button', { name: 'Check my answer' }).click();
  await expect(mission).toContainText('That is not the saved status');
  await mission.getByLabel('What status is shown on the guest report?').selectOption('Follow');
  await mission.getByRole('button', { name: 'Check my answer' }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  await expect(mission).toContainText('Your turn: Find Perch 1');
  await expect(page.getByTestId('training-spotlight')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/ui-audit/frontdesk-perch-independent.png', fullPage: true });

  await page.getByRole('textbox', { name: 'Search rooms and areas' }).fill('Perch 1');
  await expect(mission).toContainText('Your turn: Open Perch 1');
  await page.getByRole('link', { name: 'Open Perch 1' }).click();
  await expect(mission).toContainText('Your turn: Check the guest report');
  await mission.getByLabel('What status is shown on the guest report?').selectOption('Open');
  await mission.getByRole('button', { name: 'Check my answer' }).click();
  await expect(page.getByTestId('course-completed')).toContainText('Lesson 3 completed');
  await expect(mission).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('ho-training-room-mission-v1:69001'))).toBeNull();
});
