import { test, expect } from '@playwright/test';
import { departmentShiftTitle, parseShiftMission, verifyShiftRecord } from '../lib/training-shift-mission';

const roles = [
  { department: 'Front Desk', id: 41 },
  { department: 'Housekeeping', id: 42 },
  { department: 'Café', id: 43 },
  { department: 'Kitchen', id: 44 },
  { department: 'Maintenance', id: 45 },
  { department: 'Marketing', id: 46 },
  { department: 'Security', id: 47 },
] as const;

test('shift mission rejects tampered stages and unrelated records', () => {
  expect(parseShiftMission(null)).toEqual({ stage: 'intro' });
  expect(parseShiftMission('{"stage":"done"}')).toEqual({ stage: 'intro' });
  expect(parseShiftMission('{"stage":"answer","firstId":-9}')).toEqual({ stage: 'answer' });
  expect(verifyShiftRecord({ id: 99, title: '[TRAINING] Kitchen Night handover #3',
    department_id: 44, status: 'Follow' }, departmentShiftTitle('Kitchen', 'guided'), 44))
    .toEqual({ id: 99, status: 'Follow' });
  expect(verifyShiftRecord({ id: 99, title: '[TRAINING] Kitchen Night handover #3',
    department_id: 41, status: 'Follow' }, departmentShiftTitle('Kitchen', 'guided'), 44)).toBeNull();
});

for (const role of roles) {
  test(role.department + ' staff follows guided and independent real Shift page controls', async ({ page }) => {
    const user = {
      id: 70000 + role.id, name: 'Demo ' + role.department + ' Staff',
      role: 'staff', email: 'staff-' + role.id + '@training.invalid',
      departments: [{ id: role.id, name: role.department, is_primary: true }],
      primary_department_id: role.id, department_id: role.id,
      capabilities: { manage_department: false },
    };
    await page.addInitScript(current => {
      localStorage.setItem('cc_user', JSON.stringify(current));
      localStorage.setItem('cc_department_id', String(current.department_id));
      localStorage.setItem('ho-ops-structured-course-v2:' + current.id, JSON.stringify({
        lessonId: 'staff-handover', stage: 'shift-practice', question: 0, passed: ['orientation'],
      }));
    }, user);
    const guided = { id: role.id * 100 + 3, department_id: role.id, title: departmentShiftTitle(role.department, 'guided'),
      status: 'Follow', shift: 'Night', urgency: 'Urgent', note: 'Fictional night shift needs a follow-up.' };
    const solo = { id: role.id * 100 + 2, department_id: role.id, title: departmentShiftTitle(role.department, 'solo'),
      status: 'Seen', shift: 'PM', urgency: 'Normal', note: 'Fictional PM shift note.' };
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') {
        return route.fulfill({ status: 405, body: 'Training mission may not write records.' });
      }
      let result: unknown = { counts: {}, items: [], next_cursor: null, has_more: false };
      if (url.pathname === '/api/shift-notes') result = { items: [guided,solo], next_cursor: null, has_more: false };
      if (url.pathname === '/api/shift-notes/' + guided.id) result = guided;
      if (url.pathname === '/api/shift-notes/' + solo.id) result = solo;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    await page.goto('/shift');
    const mission = page.getByTestId('department-shift-practice');
    await expect(mission).toContainText(role.department.toUpperCase());
    await mission.getByText('Show me an example').click();
    await expect(mission).toContainText('Night handover');
    await mission.getByRole('button', { name: 'Help me do it' }).click();
    await page.getByRole('button', { name: 'Urgent', exact: true }).click();
    await expect(mission).toContainText('Open your department');
    await page.getByRole('button', { name: new RegExp(role.department + ' Night handover #3') }).click();
    await expect(mission).toContainText('Check the saved handover status');
    await mission.getByLabel('What status is shown on this handover?').selectOption('Done');
    await mission.getByRole('button', { name: 'Check my answer' }).click();
    await expect(mission).toContainText('does not match the saved record');
    await mission.getByLabel('What status is shown on this handover?').selectOption('Follow');
    await mission.getByRole('button', { name: 'Check my answer' }).click();
    await expect(mission).toContainText('Your turn: Find the PM handover');
    await page.getByRole('button', { name: 'PM', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(role.department + ' PM handover #2') }).click();
    await expect(mission).toContainText('Your turn: Read its status');
    await mission.getByLabel('What status is shown on this handover?').selectOption('Seen');
    await mission.getByRole('button', { name: 'Check my answer' }).click();
    await expect(page.getByTestId('course-completed')).toContainText('Lesson 2 completed');
    await expect(mission).toHaveCount(0);
  });
}
