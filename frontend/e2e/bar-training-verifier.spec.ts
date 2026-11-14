import { expect, test } from '@playwright/test';
import { availableTrainingLessons } from '../lib/interactive-training';
import { parseWorkflowSession, verifyWorkflowStep, workflowSessionKey, type TrainingWorkflowSession } from '../lib/training-workflows';

const session: TrainingWorkflowSession = {
  kind: 'bar-report', ownerId: '99', reference: 'TRN-BAR-ABCD1234',
  createdAt: '2026-11-10T01:00:00Z', step: 0, departmentId: 8,
};
const correct = {
  id: 123, title: 'TRN-BAR-ABCD1234 Mocktail syrup low', category: 'Low stock',
  note: 'Mocktail syrup almost gone. Count bottles and tell the next bartender on the next shift.',
  department_id: 8, status: 'New', urgency: 'Normal',
};

test('Bar reporting lesson belongs only to actual Bar members, including ordinary staff', () => {
  const staffCapabilities = { manage_department: false, view_all_operations: false };
  expect(availableTrainingLessons(staffCapabilities, [{ name: 'Bar' }]).some(x => x.id === 'bar')).toBe(true);
  expect(availableTrainingLessons(staffCapabilities, [{ name: 'Kitchen' }, { name: 'Housekeeping' }]).some(x => x.id === 'bar')).toBe(false);
  expect(availableTrainingLessons({ ...staffCapabilities, view_all_operations: true }, [{ name: 'Front Desk' }]).some(x => x.id === 'bar')).toBe(false);
});

test('Bar verified practical requires a saved, department-matched incident with actionable shift details', () => {
  expect(verifyWorkflowStep(session, []).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, department_id: 9 }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, category: 'Equipment' }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, note: 'Need more syrup' }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [{ ...correct, title: 'Some unrelated note' }]).passed).toBe(false);
  expect(verifyWorkflowStep(session, [correct])).toMatchObject({ passed: true, recordId: 123 });
});

test('Bar practice refuses unscoped or mismatched training sessions', () => {
  const missing = { ...session, departmentId: undefined };
  expect(parseWorkflowSession(JSON.stringify(missing), session.ownerId)).toBeNull();
  expect(parseWorkflowSession(JSON.stringify(session), 'different-user')).toBeNull();
  expect(parseWorkflowSession(JSON.stringify(session), session.ownerId)).toMatchObject({
    kind: 'bar-report', departmentId: 8, reference: session.reference,
  });
});

for (const isBarMember of [true, false]) test(`saved Bar practice guide is ${isBarMember ? 'available to Bar staff' : 'not available to unrelated staff'}`, async ({ page }) => {
  const user = { id: 99, name: 'Fictional staff', role: 'staff', email: 'practice@training.invalid',
    primary_department_id: isBarMember ? 8 : 9,
    departments: [{ id: isBarMember ? 8 : 9, name: isBarMember ? 'Bar' : 'Kitchen', is_primary: true }],
    capabilities: { manage_department: false } };
  const key = workflowSessionKey(user);
  await page.addInitScript(({account, storageKey, practice}) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', String(account.primary_department_id));
    localStorage.setItem(storageKey, JSON.stringify(practice));
  }, {account: user, storageKey: key, practice: session});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const value = path === '/api/meta' ? { departments: user.departments, users: [] }
      : { items: [], counts: {}, groups: {}, unread_count: 0, has_more: false };
    return route.fulfill({ status: 200, json: value });
  });
  await page.goto('/training');
  if (isBarMember) await expect(page.getByTestId('training-workflow-coach')).toBeVisible();
  else await expect(page.getByTestId('training-workflow-coach')).toHaveCount(0);
});

test('a completed practice does not reopen its spotlight over the next lesson', async ({ page }) => {
  const user = { id: 99, name: 'Fictional bartender', role: 'staff', primary_department_id: 8,
    departments: [{ id: 8, name: 'Bar', is_primary: true }], capabilities: { manage_department: false } };
  await page.addInitScript(({account, storageKey, practice}) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '8');
    localStorage.setItem(storageKey, JSON.stringify(practice));
  }, {account: user, storageKey: workflowSessionKey(user), practice: { ...session, step: 1, recordId: 123 }});
  await page.route('**/api/**', route => route.fulfill({ status: 200, json: { items: [], counts: {}, groups: {}, unread_count: 0 } }));
  await page.goto('/training');
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Practice finished');
  await expect(page.getByTestId('training-spotlight').filter({ hasText: 'You finished this practice' })).toHaveCount(0);
  await page.getByTestId('show-workflow-arrows').click();
  await expect(page.getByTestId('training-spotlight').filter({ hasText: 'You finished this practice' })).toBeVisible();
});
