import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { availableTrainingLessons } from '../lib/interactive-training';
import { COURSE_GUIDES } from '../lib/training-course';
import { completeReadOnlyLesson } from './live-course-helpers';
import { INDEPENDENT_CHECKS } from '../lib/training-independent';

// Opt-in only: use a freshly seeded, disposable localhost database. Never production.
const rosterPath = process.env.TRAINING_WALKTHROUGH_ROSTER;
test.skip(!rosterPath, 'Requires a disposable local training DB and private synthetic roster');

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
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
  expect(lessons.map(l => l.id)).toEqual(['orientation', 'staff-handover', 'staff-rooms', 'room-arrivals', 'staff-my-work']);
  const writes: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
  for (const lesson of lessons) await completeReadOnlyLesson(page, lesson);
  await expect(page.getByTestId('course-progress-summary')).toContainText('5');
  expect(writes).toEqual([]);
  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-live-staff-finished.png', fullPage: true });
});

test('fresh manager learns the first five lessons and saves, starts and submits an assigned task against the real API', async ({ page }) => {
  const user = await signIn(page, 'manager@training.invalid');
  const lessons = availableTrainingLessons(user.capabilities, user.departments);
  for (const lesson of lessons.slice(0, 5)) await completeReadOnlyLesson(page, lesson);
  const lesson = lessons[5];
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
  await expect(page.getByTestId('course-completed')).toContainText('Lesson 6 completed');
  mkdirSync('test-results/ui-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-live-manager-task.png', fullPage: true });
});
