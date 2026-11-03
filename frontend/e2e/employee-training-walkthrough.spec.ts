import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PRACTICE_SCENARIOS, practiceScenariosFor } from '../lib/practice-scenarios';
import { parseScenarioDrafts } from '../lib/training-scenario-drafts';
import { parseScenarioProgress } from '../lib/training-progress';

const staff = { id: 6111, name: 'Fictional New Receptionist', email: 'new@training.invalid', role: 'staff',
  departments: [{ id: 41, name: 'Front Desk' }], primary_department_id: 41, capabilities: {} };
const courseDone = ['orientation', 'staff-handover', 'staff-rooms', 'staff-my-work'];
async function login(page: import('@playwright/test').Page, finished = false) {
  await page.addInitScript(({ user, done, passed }) => {
    if (!localStorage.getItem('cc_user')) {
      localStorage.setItem('cc_user', JSON.stringify(user));
      localStorage.setItem('cc_department_id', '41');
      if (done) localStorage.setItem('ho-ops-structured-course-v2:' + user.id, JSON.stringify({ lessonId: 'staff-my-work', stage: 'finished', passed, question: 0 }));
      localStorage.setItem('ho-ops-scenario-practice-v1:' + user.id + ':guide-intro-v2', 'yes');
    }
  }, { user: staff, done: finished, passed: courseDone });
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], groups: {}, counts: {}, unread_count: 0 }) }));
}

test('required lesson and resume dialog keep keyboard focus inside', async ({ page }) => {
  await login(page);
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Required training lesson', exact: true });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('course-start-quiz')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByText('Need help with this lesson?', { exact: true })).toBeFocused();
  await page.getByTestId('course-start-quiz').click();
  await expect(dialog).toBeFocused();
  await dialog.getByRole('radio', { name: 'My Work', exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await dialog.getByRole('radio', { name: "Read the related task and check what still needs doing" }).check();
  await page.getByTestId('course-check-answer').click();
  await page.reload();
  const resume = page.getByRole('dialog', { name: 'Resume required training' });
  await expect(resume).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(resume.getByRole('button')).toBeFocused();
});

test('mobile orientation points to the menu when My Work is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Required training lesson', exact: true });
  await page.getByTestId('course-start-quiz').click();
  await dialog.getByRole('radio', { name: 'My Work', exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await dialog.getByRole('radio', { name: "Read the related task and check what still needs doing" }).check();
  await page.getByTestId('course-check-answer').click();
  const tip = page.locator('.ops-guide-tip');
  await tip.getByRole('button', { name: /Next/ }).click();
  await expect(tip).toContainText('Open the highlighted navigation menu');
  await expect(page.locator('.ops-guide-spotlight')).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(tip).toContainText('Read your tasks');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-employee-mobile.png', fullPage: true });
});

test('drafts keep corrections and typed work across case switches and reload', async ({ page }) => {
  await login(page, true);
  await page.goto('/training');
  await page.getByTestId('scenario-priority').selectOption('Routine');
  await page.getByTestId('scenario-department').selectOption('Front Desk');
  await page.getByTestId('scenario-check-assessment').click();
  await page.getByTestId('scenario-priority').selectOption('High');
  await page.getByTestId('scenario-check-assessment').click();
  const example = PRACTICE_SCENARIOS.find(s => s.id === 'shift-unresolved')!.example;
  await page.getByTestId('scenario-decision').selectOption('Assign and follow up');
  await page.getByTestId('scenario-note').fill(example);
  await page.getByTestId('scenario-guest-ac').click();
  await expect(page.getByTestId('scenario-shift-unresolved')).toContainText('In progress');
  await page.getByTestId('scenario-shift-unresolved').click();
  await expect(page.getByTestId('scenario-note')).toHaveValue(example);
  await page.reload();
  await expect(page.getByTestId('scenario-note')).toHaveValue(example);
  await page.getByTestId('scenario-submit').click();
  await expect(page.getByTestId('scenario-complete')).toContainText('Changes made: 1');
  await expect(page.getByTestId('scenario-complete')).toContainText('Your response:');
  await page.reload();
  await expect(page.getByTestId('scenario-complete')).toContainText(example);
});

test('repeated hints do not erase a completed result on reload', () => {
  const progress = parseScenarioProgress({ 'guest-ac': { attempts: 2, mistakes: 0, hints: 5, firstTry: true,
    completedAt: '2026-11-02T10:00:00Z' } }, ['guest-ac']);
  expect(progress['guest-ac']).toMatchObject({ attempts: 2, hints: 5, firstTry: false });
});

test('draft parser ignores corrupt and unavailable cases and cannot award completion', () => {
  const scenarios = practiceScenariosFor(staff);
  const partial = { answers: { priority: '', department: '', decision: '', note: '', owner: '', followUp: '' },
    phase: 'complete', attempts: 0, hintsUsed: 0, mistakesMade: 0, reasoning: { consequence: '', timing: '' } };
  expect(parseScenarioDrafts({ 'guest-ac': partial, 'manager-evidence': partial }, scenarios)).toMatchObject({ 'guest-ac': { phase: 'assess' } });
  expect(parseScenarioDrafts({ 'guest-ac': partial }, scenarios)['manager-evidence']).toBeUndefined();
  expect(parseScenarioDrafts({ 'guest-ac': { ...partial, hintsUsed: -1 } }, scenarios)).toEqual({});
  expect(parseScenarioDrafts({ 'guest-ac': { ...partial, answers: null } }, scenarios)).toEqual({});
});

test('the final case has a clear finish and exports the trainee response even during a repeat', async ({ page }) => {
  await login(page, true);
  const available = practiceScenariosFor(staff);
  await page.addInitScript(({ ids, id }) => {
    const key = 'ho-ops-scenario-practice-v1:' + id;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(Object.fromEntries(ids.map(caseId => [caseId, {
      attempts: 2, hints: 0, mistakes: 0, firstTry: true, completedAt: '2026-11-02T10:00:00Z',
    }]))));
  }, { ids: available.filter(s => s.id !== 'shift-unresolved').map(s => s.id), id: staff.id });
  await page.goto('/training');
  await page.getByTestId('scenario-priority').selectOption('High');
  await page.getByTestId('scenario-department').selectOption('Front Desk');
  await page.getByTestId('scenario-check-assessment').click();
  await page.getByTestId('scenario-decision').selectOption('Assign and follow up');
  const example = '=DEMO-HANDOVER-014: Front Desk must call the practice guest, assign an owner and update the next shift on the unresolved concern.';
  await page.getByTestId('scenario-note').fill(example);
  await page.getByTestId('scenario-submit').click();
  await expect(page.getByRole('heading', { name: `All ${available.length} situations finished` })).toBeVisible();
  await expect(page.getByTestId('scenario-next')).toHaveCount(0);
  await page.getByTestId('scenario-repeat').click();
  await expect(page.getByTestId('scenario-triage')).toBeVisible();
  await page.reload();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save my results' }).click();
  const { readFileSync } = await import('node:fs');
  const csv = readFileSync((await (await downloaded).path())!, 'utf8');
  expect(csv).toContain('"trainee_name"');
  expect(csv).toContain('Fictional New Receptionist');
  expect(csv).toContain('"\'=DEMO-HANDOVER-014:');
  expect(csv).toContain('Front Desk must call');
});

test('unavailable draft storage shows a clear warning while practice remains usable', async ({ page }) => {
  await login(page, true);
  await page.goto('/training');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('ho-ops-scenario-drafts-')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByTestId('scenario-priority').selectOption('High');
  await expect(page.getByText('This browser could not save your practice.')).toBeVisible();
  await page.getByTestId('scenario-department').selectOption('Front Desk');
  await page.getByTestId('scenario-check-assessment').click();
  await expect(page.getByTestId('scenario-document')).toBeVisible();
});

test('a delayed navigation callback cannot rewind the next tour step', async ({ page }) => {
  await login(page);
  await page.addInitScript(id => localStorage.setItem('ho-ops-structured-course-v2:' + id,
    JSON.stringify({ lessonId: 'orientation', stage: 'tour', question: 0, passed: [] })), staff.id);
  await page.goto('/');
  await page.getByRole('button', { name: /Resume practical lesson/ }).click();
  const tip = page.locator('.ops-guide-tip');
  await tip.getByRole('button', { name: 'Next →', exact: true }).click();
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(tip).toContainText('Read your tasks');
  await tip.getByRole('button', { name: 'Next →', exact: true }).click();
  // The old implementation queued a 100 ms callback which could restore step 3.
  await page.waitForTimeout(200);
  await expect(tip).toContainText('Open Notifications');
  await page.locator('a.ops-notifications').click();
  await expect(tip).toContainText('Read the update');
});
