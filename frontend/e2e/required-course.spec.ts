import { expect, test } from '@playwright/test';
import { COURSE_GUIDES, readCourseProgress } from '../lib/training-course';
import { TRAINING_LESSONS, availableTrainingLessons } from '../lib/interactive-training';

const staff = {
  id: 92811, name: 'Practice Reception Trainee', email: 'course-practice@training.invalid',
  role: 'staff', is_active: true, departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  primary_department_id: 41, capabilities: {},
};

test('every role-available lesson has two clear teaching checks and example before practice', () => {
  for (const lesson of TRAINING_LESSONS) {
    const guide = COURSE_GUIDES[lesson.id];
    expect(guide, 'Missing curriculum for ' + lesson.id).toBeDefined();
    expect(guide.explanation.length, lesson.id).toBeGreaterThan(75);
    expect(guide.example.length, lesson.id).toBeGreaterThan(30);
    expect(guide.questions).toHaveLength(2);
    for (const question of guide.questions) {
      expect(question.choices).toHaveLength(3);
      expect(question.correct).toBeGreaterThanOrEqual(0);
      expect(question.correct).toBeLessThan(3);
      expect(question.explanation.length).toBeGreaterThan(15);
    }
  }
});

test('lesson progress parser rejects invalid lesson ids and incomplete practice state', () => {
  const lessons = availableTrainingLessons({ manage_department: false, make_decisions: false, manage_accounts: false });
  expect(readCourseProgress(null, lessons)).toMatchObject({ stage: 'learn', lessonId: 'orientation' });
  expect(readCourseProgress('{"lessonId":"no-such-lesson","stage":"finished"}', lessons).lessonId).toBe('orientation');
  expect(readCourseProgress('{"lessonId":"team-tasks","stage":"work","question":2}', lessons).stage).toBe('learn');
  expect(readCourseProgress('{"lessonId":"orientation","stage":"work","question":2}', lessons).stage).toBe('learn');
});

async function mockLogin(page: import('@playwright/test').Page) {
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '41');
  }, staff);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], groups: {}, counts: {}, unread_count: 0 }),
  }));
}

test('first sign-in forces Lesson 1, quiz with correction, then actual-page practice', async ({ page }) => {
  await mockLogin(page);
  await page.goto('/');
  const panel = page.getByTestId('required-training-course');
  await expect(panel).toContainText('Lesson 1 of');
  await expect(panel).toContainText('Example');
  await expect(page.locator('.ops-guide-tip')).toHaveCount(0);
  await page.getByTestId('course-start-quiz').click();
  await expect(panel).toContainText('Where do you go first');
  await expect(page.getByTestId('course-start-quiz')).toHaveCount(0);
  await panel.getByLabel('Rooms', { exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await expect(panel).toContainText('Not yet');
  await expect(page.locator('.ops-guide-tip')).toHaveCount(0);
  await panel.getByLabel('My Work', { exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await expect(panel).toContainText('You read a notification');
  await panel.getByLabel('Read the linked work and check what action is still needed').check();
  await page.getByTestId('course-check-answer').click();
  await expect(panel).toHaveCount(0);
  const coach = page.locator('.ops-guide-tip');
  await expect(coach).toContainText('real training dashboard');
  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Find My Work');
  await expect(coach.getByRole('button', { name: /Click highlighted link/ })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(coach).toContainText('Find My Work');
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(coach).toContainText('Review your assigned work');
  await page.reload();
  await expect(page.getByTestId('course-lesson-title')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Resume required training' })).toBeVisible();
  await page.getByRole('button', { name: /Resume practical lesson/ }).click();
  await expect(coach).toContainText('real training dashboard');
});

test('finished curriculum unlocks its completed tour without giving unearned staff write permissions', async ({ page }) => {
  await mockLogin(page);
  await page.addInitScript(user => {
    localStorage.setItem('ho-ops-structured-course-v2:' + String(user.id), JSON.stringify({
      lessonId: 'staff-my-work', stage: 'finished', question: 0,
      passed: ['orientation','staff-handover','staff-rooms','staff-my-work'],
    }));
  }, staff);
  await page.goto('/');
  await expect(page.getByTestId('required-training-course')).toHaveCount(0);
  await page.getByTestId('interactive-training-open').click();
  await expect(page.getByRole('button', { name: /Getting around Operations/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Creating and managing a task/ })).toHaveCount(0);
});
