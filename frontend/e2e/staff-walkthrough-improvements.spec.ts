import { expect, test } from '@playwright/test';
import { courseGuideFor, readCourseProgress } from '../lib/training-course';
import { availableTrainingLessons } from '../lib/interactive-training';
import { assessShiftNote, shiftCaseFor } from '../lib/training-shift-challenge';

test('shared examples fit the staff role and do not promise an invisible room report', () => {
  expect(courseGuideFor('staff-handover', 'Kitchen', false)?.example).toContain('allergy');
  expect(courseGuideFor('staff-handover', 'Security', false)?.example).toContain('gate');
  expect(courseGuideFor('staff-rooms', 'Kitchen', false)?.example).toContain('cannot see a report');
  expect(courseGuideFor('staff-rooms', 'Front Desk', true)?.example).toContain('saved guest report');
});

test('technicians receive the new repair status lesson without losing earlier progress', () => {
  const lessons = availableTrainingLessons({}, [{ name: 'Maintenance' }]);
  expect(lessons.map(l => l.id)).toContain('maintenance-status');
  expect(availableTrainingLessons({}, [{ name: 'Kitchen' }]).map(l => l.id)).not.toContain('maintenance-status');
  const passed = lessons.map(l => l.id).filter(id => id !== 'maintenance-status');
  const restored = readCourseProgress(JSON.stringify({ lessonId: 'staff-my-work', stage: 'finished', passed }), lessons);
  expect(restored.lessonId).toBe('maintenance-status');
  expect(restored.passed).toEqual(passed);
});

test('allergy notes accept ordinary safe wording and show specific missing feedback', () => {
  const c = shiftCaseFor({ role: 'staff', departments: [{ id: 1, name: 'Kitchen' }], primary_department_id: 1 })!;
  const answer = { status: 'Follow', priority: 'Critical', team: 'Kitchen', decision: 'Escalate immediately',
    owner: 'Kitchen lead', followUp: 'Kitchen lead checks ingredients immediately before service.',
    note: 'SHIFT-KT-01: Keep the dessert plate out of service. The Kitchen lead must check the ingredients before serving.' };
  expect(assessShiftNote(c, answer).note).toBeUndefined();
  const missing = assessShiftNote(c, { ...answer, note: 'SHIFT-KT-01: The guest has a nut allergy. The Kitchen lead will check the ingredient list before service.' });
  expect(missing.note).toContain('kept out of service');
});

test('a Security employee sees a handover example about Security', async ({ page }) => {
  const user = { id: 883, name: 'Practice guard', role: 'staff', is_active: true,
    departments: [{ id: 12, name: 'Security' }], primary_department_id: 12, capabilities: {} };
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '12');
    localStorage.setItem('ho-ops-structured-course-v2:' + user.id,
      JSON.stringify({ lessonId: 'staff-handover', stage: 'learn', question: 0, passed: ['orientation'] }));
  }, user);
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], groups: {}, counts: {}, unread_count: 0 }) }));
  await page.goto('/');
  const lesson = page.getByRole('dialog', { name: 'Required training lesson', exact: true });
  await expect(lesson).toContainText('pool gate');
  await expect(lesson).toContainText('Security lead');
  await expect(lesson).not.toContainText('broken toilet');
});

test('a technician can read a repair and close it with Escape', async ({ page }) => {
  const user = { id: 884, name: 'Practice technician', role: 'staff', is_active: true,
    departments: [{ id: 13, name: 'Maintenance' }], primary_department_id: 13, capabilities: {} };
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '13');
    localStorage.setItem('ho-ops-structured-course-v2:' + user.id, JSON.stringify({
      lessonId: 'maintenance-status', stage: 'independent', question: 0, independentStep: 0,
      passed: ['orientation', 'staff-handover', 'staff-rooms', 'staff-my-work'],
    }));
  }, user);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/fixes') ? { items: [{ id: 17, title: '[TRAINING] Solace: warm air', status: 'Working', urgency: 'Urgent', room_area_id: 4, problem: 'The air conditioner blows warm air.' }] }
      : path.endsWith('/rooms') ? { items: [{ id: 4, name: 'Solace', kind: 'room' }] }
        : { items: [], users: [], groups: {}, counts: {}, unread_count: 0 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/fixes');
  await expect(page.getByTestId('course-independent-challenge')).toContainText('Open a repair');
  await page.getByRole('button', { name: /Solace: warm air/ }).click();
  await expect(page.getByRole('dialog')).toContainText('air conditioner blows warm air');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Active', exact: true }).click();
  await expect(page.getByTestId('course-completed')).toBeVisible();
});
