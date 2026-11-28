import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { COURSE_GUIDES } from '../lib/training-course';
import { TRAINING_LESSONS } from '../lib/interactive-training';
import { PRACTICE_SCENARIOS, practiceScenariosFor } from '../lib/practice-scenarios';
import { parseScenarioDrafts, scenarioAnswerLengthErrors } from '../lib/training-scenario-drafts';

const user = { id: 99871, name: 'Fictional regression trainee', email: 'regression@training.invalid',
  role: 'staff', primary_department_id: 41, departments: [{ id: 41, name: 'Front Desk', is_primary: true }], capabilities: {} };
const example = PRACTICE_SCENARIOS.find(s => s.id === 'shift-unresolved')!.example;

async function setup(page: import('@playwright/test').Page, legacyNote?: string) {
  await page.addInitScript(({ account, note }) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id + ':paused', 'true');
    localStorage.setItem('ho-ops-scenario-practice-v1:' + account.id + ':guide-intro-v2', 'yes');
    const key = 'ho-ops-scenario-drafts-v1:' + account.id;
    if (note && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      'shift-unresolved': { answers: { priority: 'High', department: 'Front Desk', decision: 'Assign and follow up',
        note, owner: '', followUp: '' }, phase: 'document', attempts: 1, hintsUsed: 0, mistakesMade: 0,
        reasoning: { consequence: '', timing: '' } },
    }));
  }, { account: user, note: legacyNote });
  await page.route('**/api/**', route => route.fulfill({ status: 200,
    json: { items: [], groups: {}, counts: {}, unread_count: 0 } }));
  await page.goto('/training');
  if (!legacyNote) {
    await page.getByTestId('scenario-priority').selectOption('High');
    await page.getByTestId('scenario-department').selectOption('Front Desk');
    await page.getByTestId('scenario-check-assessment').click();
  }
  await expect(page.getByTestId('scenario-document')).toBeVisible();
}

for (const [id, guide] of Object.entries(COURSE_GUIDES)) test(`important terms are highlighted in the ${id} lesson`, async ({ page }) => {
  expect(guide.keyTerms.length).toBeGreaterThanOrEqual(3);
  const account = id === 'maintenance-status'
    ? { ...user, departments: [{ id: 44, name: 'Maintenance', is_primary: true }], primary_department_id: 44 }
    : { ...user, role: 'owner', departments: [...user.departments, { id: 48, name: 'Bar', is_primary: false }],
        capabilities: { manage_department: true, make_decisions: true, manage_accounts: true, view_all_operations: true } };
  await page.addInitScript(({ account, lessonId, passed }) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', String(account.primary_department_id));
    localStorage.setItem('ho-ops-structured-course-v2:' + account.id,
      JSON.stringify({ practiceRevision: 2, lessonId, stage: 'learn', question: 0, passed }));
  }, { account, lessonId: id, passed: TRAINING_LESSONS.map(item => item.id).filter(lessonId => lessonId !== id) });
  await page.route('**/api/**', route => route.fulfill({ status: 200,
    json: { items: [], groups: {}, counts: {}, unread_count: 0 } }));
  await page.goto('/');
  const course = page.getByTestId('required-training-course');
  await expect(page.getByTestId('course-lesson-title')).toHaveText(TRAINING_LESSONS.find(item => item.id === id)!.title);
  await expect(course.locator('.ops-lesson-key-term').first()).toBeVisible();
  if (id === 'bar') await expect(course.locator('.ops-lesson-key-term').filter({ hasText: /^Café$/ }).first()).toBeVisible();
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
});

test('lesson one visibly emphasizes My Work and reminders while quiz choices remain plain', async ({ page }) => {
  await page.addInitScript(account => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '41');
  }, user);
  await page.route('**/api/**', route => route.fulfill({ status: 200,
    json: { items: [], groups: {}, counts: {}, unread_count: 0 } }));
  await page.goto('/');
  const course = page.getByTestId('required-training-course');
  const highlighted = course.locator('.ops-lesson-key-term');
  await expect(highlighted.filter({ hasText: /^My Work$/ }).first()).toBeVisible();
  await expect(highlighted.filter({ hasText: /^Notifications$/ }).first()).toBeVisible();
  await expect(highlighted.filter({ hasText: 'Clicking Next cannot replace these actions' })).toHaveCount(1);
  const colors = await highlighted.first().evaluate(node => {
    const style = getComputedStyle(node);
    return { color: style.color, background: style.backgroundColor, weight: style.fontWeight };
  });
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(colors.color).not.toBe(colors.background);
  expect(Number(colors.weight)).toBeGreaterThanOrEqual(700);
  await page.getByTestId('course-start-quiz').click();
  await expect(course.locator('.ops-course-choices .ops-lesson-key-term')).toHaveCount(0);
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
});

test('rejected notes can be shown to a trainer and left unfinished without losing the draft', async ({ page }) => {
  await setup(page);
  const note = 'The next shift should do something about this situation, but this note has no specific practice reference or guest action.';
  await page.getByTestId('scenario-decision').selectOption('Assign and follow up');
  await page.getByTestId('scenario-note').fill(note);
  await page.getByTestId('scenario-submit').click();
  await expect(page.getByText('If your note already covers this, ask your trainer to review it.', { exact: true })).toBeVisible();
  await page.getByText('See an example note', { exact: true }).click();
  await expect(page.locator('details[open]')).toContainText(example);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save note for trainer', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('practice-note-for-trainer.txt');
  const content = await readFile((await download.path())!, 'utf8');
  expect(content).toContain(note);
  expect(content).toContain('DEMO-HANDOVER-014');
  expect(content).toContain('This practice has not been marked complete.');
  await expect(page.getByTestId('scenario-complete')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try another situation', exact: true }).click();
  await expect(page.getByTestId('scenario-shift-unresolved')).toContainText('In progress');
  await page.getByTestId('scenario-shift-unresolved').click();
  await expect(page.getByTestId('scenario-note')).toHaveValue(note);
  await page.reload();
  await expect(page.getByTestId('scenario-note')).toHaveValue(note);
  await expect(page.getByTestId('scenario-shift-unresolved')).toContainText('In progress');
  await expect(page.getByTestId('scenario-complete')).toHaveCount(0);
});

test('an untouched scenario stays unstarted and a genuinely completed response stays Completed', async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId('scenario-guest-ac')).toContainText('Not completed');
  await page.getByTestId('scenario-guest-ac').click();
  await expect(page.getByTestId('scenario-guest-ac')).toContainText('Not completed');
  await page.getByTestId('judgment-consequence').getByLabel('A person could get hurt', { exact: true }).check();
  await expect(page.getByTestId('scenario-guest-ac')).toContainText('In progress');
  await page.getByTestId('scenario-shift-unresolved').click();
  await page.getByTestId('scenario-decision').selectOption('Assign and follow up');
  await page.getByTestId('scenario-note').fill(example);
  await page.getByTestId('scenario-submit').click();
  await expect(page.getByTestId('scenario-complete')).toBeVisible();
  await expect(page.getByTestId('scenario-shift-unresolved')).toContainText('Completed');
  await page.reload();
  await expect(page.getByTestId('scenario-shift-unresolved')).toContainText('Completed');
});

test('a note at the typing limit survives reload and extra typing cannot create a discarded draft', async ({ page }) => {
  await setup(page);
  const input = page.getByTestId('scenario-note');
  await expect(input).toHaveAttribute('maxlength', '4000');
  const note = 'a'.repeat(4000);
  await input.fill(note);
  await input.press('End');
  await input.pressSequentially('xx');
  await expect(input).toHaveValue(note);
  await page.reload();
  await expect(page.getByTestId('scenario-note')).toHaveValue(note);
  await expect(page.getByTestId('scenario-complete')).toHaveCount(0);
});

test('an existing over-limit note is preserved, explained and downloadable without receiving completion', async ({ page }) => {
  const note = example + '\n' + 'a'.repeat(4001);
  await setup(page, note);
  await expect(page.getByTestId('scenario-note')).toHaveValue(note);
  await page.getByTestId('scenario-submit').click();
  await expect(page.getByTestId('scenario-document').getByRole('alert')).toContainText('Your saved note is kept. Shorten it to 4,000 characters');
  await expect(page.getByTestId('scenario-complete')).toHaveCount(0);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save note for trainer', exact: true }).click();
  const download = await pending;
  expect(await readFile((await download.path())!, 'utf8')).toContain(note);
  await page.reload();
  await expect(page.getByTestId('scenario-note')).toHaveValue(note);
  await page.getByTestId('scenario-note').fill(example);
  await page.getByTestId('scenario-submit').click();
  await expect(page.getByTestId('scenario-complete')).toBeVisible();
});

test('legacy oversized owner and follow-up text survive parsing but cannot restore a completed draft', () => {
  const answers = { priority: 'High', department: 'Front Desk', decision: 'Assign and follow up', note: example,
    owner: 'a'.repeat(201), followUp: 'b'.repeat(1501) };
  const parsed = parseScenarioDrafts({ 'shift-unresolved': { answers, phase: 'complete', attempts: 1,
    hintsUsed: 0, mistakesMade: 0, reasoning: { consequence: '', timing: '' } } }, practiceScenariosFor(user));
  expect(parsed['shift-unresolved'].answers).toEqual(answers);
  expect(parsed['shift-unresolved'].phase).toBe('document');
  expect(scenarioAnswerLengthErrors(parsed['shift-unresolved'].answers)).toHaveProperty('owner');
  expect(scenarioAnswerLengthErrors(parsed['shift-unresolved'].answers)).toHaveProperty('followUp');
});
