import { expect, test } from '@playwright/test';
import { PRACTICE_SCENARIOS, practiceScenariosFor } from '../lib/practice-scenarios';
import { parseScenarioDrafts } from '../lib/training-scenario-drafts';

const user = { id: 97411, name: 'Fictional Front Desk Staff', email: 'draft-check@training.invalid',
  role: 'staff', departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  primary_department_id: 41, capabilities: {} };

test('scenario drafts preserve typed work across switching situations and reloading', async ({ page }) => {
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id + ':paused', 'true');
    localStorage.setItem('ho-ops-scenario-practice-v1:' + account.id + ':guide-intro-v2', 'yes');
  }, user);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], groups: {}, counts: {}, unread_count: 0 }),
  }));
  await page.goto('/training');
  await expect(page.getByTestId('scenario-shift-unresolved')).toBeVisible();
  await page.getByTestId('scenario-priority').selectOption('High');
  await page.getByTestId('scenario-department').selectOption('Front Desk');
  await page.getByTestId('scenario-check-assessment').click();
  await expect(page.getByTestId('scenario-document')).toBeVisible();

  const text = PRACTICE_SCENARIOS.find(item => item.id === 'shift-unresolved')!.example;
  await page.getByTestId('scenario-note').fill(text);
  await page.getByTestId('scenario-guest-ac').click();
  await page.getByTestId('scenario-shift-unresolved').click();
  await expect(page.getByTestId('scenario-note')).toHaveValue(text);
  await page.reload();
  await expect(page.getByTestId('scenario-note')).toHaveValue(text);
  // Restored answers do not silently mark this exercise as completed.
  await expect(page.getByTestId('scenario-complete')).toHaveCount(0);
});

test('untrusted draft data cannot award an unearned case completion', () => {
  const scenarios = practiceScenariosFor(user);
  const draft = {
    answers: { priority: '', department: '', decision: '', note: '', owner: '', followUp: '' },
    phase: 'complete', attempts: 0, hintsUsed: 0, mistakesMade: 0,
    reasoning: { consequence: '', timing: '' },
  };
  expect(parseScenarioDrafts({ 'shift-unresolved': draft }, scenarios)['shift-unresolved'].phase).toBe('assess');
  expect(parseScenarioDrafts({ 'shift-unresolved': { ...draft, hintsUsed: -1 } }, scenarios)).toEqual({});
  expect(parseScenarioDrafts({ 'shift-unresolved': { ...draft, answers: null } }, scenarios)).toEqual({});
});
