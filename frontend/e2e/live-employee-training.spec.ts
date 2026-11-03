import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { availableTrainingLessons } from '../lib/interactive-training';
import { COURSE_GUIDES } from '../lib/training-course';
import { INDEPENDENT_CHECKS } from '../lib/training-independent';

// Opt-in only: use a freshly seeded, disposable localhost database. Never production.
const rosterPath = process.env.TRAINING_WALKTHROUGH_ROSTER;
test.skip(!rosterPath, 'Requires a disposable local training DB and private synthetic roster');

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  const roster = JSON.parse(readFileSync(rosterPath!, 'utf8'));
  const account = roster.accounts.find((a: { email: string }) => a.email === email);
  expect(account).toBeTruthy();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const login = await response;
  expect(login.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  return login.json();
}

test('fresh receptionist completes all required lessons using the real local API and real controls', async ({ page }) => {
  const user = await signIn(page, 'reception-pm@training.invalid');
  const lessons = availableTrainingLessons(user.capabilities, user.departments);
  expect(lessons.map(l => l.id)).toEqual(['orientation', 'staff-handover', 'staff-rooms', 'staff-my-work']);
  const writes: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
  for (const lesson of lessons) await completeReadOnlyLesson(page, lesson);
  await expect(page.getByTestId('course-progress-summary')).toContainText('4');
  expect(writes).toEqual([]);
  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-live-staff-finished.png', fullPage: true });
});

async function completeReadOnlyLesson(page: import('@playwright/test').Page, lesson: ReturnType<typeof availableTrainingLessons>[number]) {
    const course = page.getByRole('dialog', { name: 'Required training lesson', exact: true });
    await expect(page.getByTestId('course-lesson-title')).toContainText(lesson.title);
    await page.getByTestId('course-start-quiz').click();
    for (const question of COURSE_GUIDES[lesson.id].questions) {
      await course.getByRole('radio', { name: question.choices[question.correct], exact: true }).check();
      await page.getByTestId('course-check-answer').click();
    }
    if (lesson.id === 'staff-handover' && (await page.evaluate(() => JSON.parse(localStorage.getItem('cc_user') || '{}').role)) === 'staff') {
      const mission = page.getByTestId('department-shift-practice');
      await expect(mission).toContainText('Read a real-looking handover');
      await mission.getByRole('button', { name: 'Help me do it' }).click();
      await page.getByRole('tab', { name: 'Urgent', exact: true }).click();
      await expect(mission).toContainText('Open your department');
      await page.getByRole('button', { name: /Front Desk Night handover #3/ }).click();
      await expect(mission).toContainText('Check the saved handover status');
      await page.getByRole('button', { name: 'Close details' }).click();
      await mission.getByLabel('What status is shown on this handover?').selectOption('Follow');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
      await expect(mission).toContainText('Your turn: Find the PM handover');
      await page.getByRole('tab', { name: 'PM', exact: true }).click();
      await page.getByRole('button', { name: /Front Desk PM handover #2/ }).click();
      await expect(mission).toContainText('Your turn: Read its status');
      await page.getByRole('button', { name: 'Close details' }).click();
      await mission.getByLabel('What status is shown on this handover?').selectOption('Seen');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
    } else if (lesson.id === 'staff-rooms' && (await page.evaluate(() => JSON.parse(localStorage.getItem('cc_user') || '{}').role)) === 'staff') {
      const mission = page.getByTestId('frontdesk-room-mission');
      await expect(mission).toContainText('Solace');
      await mission.getByRole('button', { name: 'Help me do it' }).click();
      await page.getByRole('button', { name: 'Guest rooms' }).click();
      await page.getByRole('textbox', { name: 'Search rooms and areas' }).fill('Solace');
      await page.getByRole('link', { name: 'Open Solace' }).click();
      await expect(mission).toContainText('Read the saved guest report');
      await expect(page.getByText('[TRAINING] Solace AC not cooling')).toBeVisible();
      await mission.getByLabel('What status is shown on the guest report?').selectOption('Follow');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
      await expect(mission).toContainText('Your turn: Find Perch 1');
      await page.getByRole('textbox', { name: 'Search rooms and areas' }).fill('Perch 1');
      await page.getByRole('link', { name: 'Open Perch 1' }).click();
      await expect(page.getByText('[TRAINING] Perch 1 towel request')).toBeVisible();
      await mission.getByLabel('What status is shown on the guest report?').selectOption('Open');
      await mission.getByRole('button', { name: 'Check my answer' }).click();
    } else {
      const coach = page.locator('.ops-guide-tip');
      for (const [index, step] of lesson.steps.entries()) {
      await expect(coach.getByRole('heading')).toHaveText(step.title);
      if (step.advanceOnClick) {
        let target = page.locator(step.selector).filter({ visible: true });
        if (step.targetText) target = target.filter({ hasText: step.targetText });
        await target.first().click();
      }
      else await coach.getByRole('button', { name: index === lesson.steps.length - 1 ? 'Finish practice' : 'Next →', exact: true }).click();
      }
      for (const action of INDEPENDENT_CHECKS[lesson.id]) {
      await expect(page.getByTestId('course-independent-challenge')).toContainText(action.title);
      // The last tour click can navigate while the independent stage is opening.
      // Click only after its real target screen is active.
      await expect.poll(() => new URL(page.url()).pathname).toBe(action.path);
      let target = page.locator(action.selector).filter({ visible: true });
      if (action.containsText) target = target.filter({ hasText: action.containsText });
      if (action.type === 'input') await target.first().fill('repair');
      else await target.first().click();
      }
    }
    await expect(page.getByTestId('course-completed')).toBeVisible();
    await page.getByTestId('course-next-lesson').click();
}

test('fresh manager learns the first five lessons and saves, starts and submits an assigned task against the real API', async ({ page }) => {
  const user = await signIn(page, 'manager@training.invalid');
  const lessons = availableTrainingLessons(user.capabilities, user.departments);
  for (const lesson of lessons.slice(0, 4)) await completeReadOnlyLesson(page, lesson);
  const lesson = lessons[4];
  expect(lesson.id).toBe('team-tasks');
  const course = page.getByRole('dialog', { name: 'Required training lesson', exact: true });
  await page.getByTestId('course-start-quiz').click();
  for (const question of COURSE_GUIDES[lesson.id].questions) {
    await course.getByRole('radio', { name: question.choices[question.correct], exact: true }).check();
    await page.getByTestId('course-check-answer').click();
  }
  const tip = page.locator('.ops-guide-tip');
  for (const [index, step] of lesson.steps.entries()) {
    await expect(tip.getByRole('heading')).toHaveText(step.title);
    if (step.advanceOnClick) await page.locator(step.selector).filter({ visible: true }).first().click();
    else await tip.getByRole('button', { name: index === lesson.steps.length - 1 ? 'Finish practice' : 'Next →', exact: true }).click();
  }
  const coach = page.getByTestId('training-workflow-coach');
  await expect(coach).toContainText('Stage 1 of 3');
  await expect(page.getByTestId('training-spotlight')).toHaveCount(0);
  const reference = (await page.getByTestId('training-workflow-reference').innerText()).trim();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-message')).toContainText('No saved record');
  await page.getByTestId('create-task').click();
  const form = page.getByTestId('create-task-form');
  const title = 'Fictional first-shift task ' + reference;
  await form.getByLabel('Task title').fill(title);
  await form.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('High');
  await form.getByLabel('Assigned to').selectOption(String(user.id));
  const create = page.waitForResponse(r => r.url().endsWith('/api/tasks') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create task', exact: true }).click();
  const created = await create;
  expect(created.ok()).toBe(true);
  const record = await created.json();
  await page.getByTestId('training-check-work').click();
  await expect(coach).toContainText('Stage 2 of 3');
  for (const [button, state, stage] of [['Start work', 'Doing', 'Stage 3 of 3'], ['Submit for review', 'Review', 'Your changes were saved and checked']]) {
    await page.getByText(title, { exact: true }).click();
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect.poll(async () => {
      // Read in the browser so its Secure localhost cookie follows normal app behavior.
      const actual = await page.evaluate(async id => {
        const response = await fetch('/api/tasks/' + id, { credentials: 'same-origin' });
        return { status: response.status, record: await response.json() };
      }, record.id);
      expect(actual.status).toBe(200);
      return actual.record.status;
    }).toBe(state);
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.getByTestId('training-check-work').click();
    if (state === 'Review') {
      await expect(coach).toHaveCount(0);
      await expect(page.getByTestId('course-independent-challenge')).toBeVisible();
    } else await expect(coach).toContainText(stage);
  }
  for (const action of INDEPENDENT_CHECKS['team-tasks']) {
    await expect(page.getByTestId('course-independent-challenge')).toContainText(action.title);
    await page.locator(action.selector).filter({ hasText: action.containsText, visible: true }).first().click();
  }
  await expect(page.getByTestId('course-completed')).toContainText('Lesson 5 completed');
  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-live-manager-task.png', fullPage: true });
});
