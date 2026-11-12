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
    if (guide.repeatVariant) {
      expect(guide.repeatVariant.example.length,lesson.id).toBeGreaterThan(35);
      expect(guide.repeatVariant.questions).toHaveLength(2);
      expect(guide.repeatVariant.questions[0].prompt).not.toEqual(guide.questions[0].prompt);
    }
    expect(lesson.steps.some(step => step.requiresAction),
      lesson.id + ': practice must include at least one required real UI click').toBe(true);
    for (const question of guide.questions) {
      expect(question.choices).toHaveLength(3);
      expect(question.correct).toBeGreaterThanOrEqual(0);
      expect(question.correct).toBeLessThan(3);
      expect(question.explanation.length).toBeGreaterThan(15);
    }
  }
});

test('a saved tour step is bounded and a Bar workflow reference survives reload', () => {
  const lessons = availableTrainingLessons({manage_department:true, make_decisions:true, manage_accounts:false},
    [{name:'Bar'}]);
  const shift = readCourseProgress(JSON.stringify({
    lessonId:'staff-handover', stage:'tour', question:0, tourStep:999, passed:['orientation'],
  }), lessons);
  expect(shift.tourStep).toBe(2);
  expect(readCourseProgress(JSON.stringify({
    lessonId:'staff-handover', stage:'tour', question:0, tourStep:-5, passed:['orientation'],
  }), lessons).tourStep).toBe(0);
  const withBar = readCourseProgress(JSON.stringify({
    lessonId:'bar', stage:'work', question:0, reference:'TRN-BAR-ABCDEFGH',
    passed:lessons.filter(l=>l.id!=='bar').map(l=>l.id),
  }), lessons);
  expect(withBar.reference).toBe('TRN-BAR-ABCDEFGH');
  expect(withBar.stage).toBe('work');
});

test('lesson progress parser rejects invalid lesson ids and incomplete practice state', () => {
  const lessons = availableTrainingLessons({ manage_department: false, make_decisions: false, manage_accounts: false });
  expect(readCourseProgress(null, lessons)).toMatchObject({ stage: 'learn', lessonId: 'orientation' });
  expect(readCourseProgress('{"lessonId":"no-such-lesson","stage":"finished"}', lessons).lessonId).toBe('orientation');
  expect(readCourseProgress('{"lessonId":"team-tasks","stage":"work","question":2}', lessons).stage).toBe('learn');
  expect(readCourseProgress('{"lessonId":"orientation","stage":"work","question":2}', lessons).stage).toBe('learn');
  expect(readCourseProgress(JSON.stringify({ lessonId: 'staff-rooms', stage: 'independent', passed: ['orientation'] }), lessons)).toMatchObject({
    stage: 'learn', lessonId: 'staff-handover', passed: ['orientation'],
  });
  expect(readCourseProgress(JSON.stringify({ lessonId: 'orientation', stage: 'done', passed: [] }), lessons).stage).toBe('learn');
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

test('an incomplete stored finished marker resumes at the first incomplete lesson', async ({ page }) => {
  const lessons = availableTrainingLessons({ manage_department: false, make_decisions: false, manage_accounts: false });
  expect(lessons.length).toBeGreaterThan(1);
  const stored = JSON.stringify({ lessonId: 'orientation', stage: 'finished', question: 0, passed: ['orientation'] });
  const restored = readCourseProgress(stored, lessons);
  expect(restored.stage).toBe('learn');
  expect(restored.lessonId).toBe(lessons[1].id);
  expect(restored.passed).toEqual(['orientation']);
  await mockLogin(page);
  await page.addInitScript(({ id, progress }) => {
    localStorage.setItem('ho-ops-structured-course-v2:' + String(id), progress);
  }, { id: staff.id, progress: stored });
  await page.goto('/');
  await expect(page.getByTestId('required-training-course')).toBeVisible();
  await expect(page.getByTestId('course-lesson-title')).toContainText(lessons[1].title);
});

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
  await expect(panel).toContainText('Not quite.');
  await expect(page.locator('.ops-guide-tip')).toHaveCount(0);
  await panel.getByLabel('My Work', { exact: true }).check();
  await page.getByTestId('course-check-answer').click();
  await expect(panel).toContainText('You read a notification');
  await panel.getByLabel("Read the related task and check what still needs doing").check();
  await page.getByTestId('course-check-answer').click();
  await expect(panel).toHaveCount(0);
  const coach = page.locator('.ops-guide-tip');
  await expect(coach).toContainText('Your start page');
  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Open My Work');
  await expect(coach.getByRole('button', { name: /Click highlighted link/ })).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(coach).toContainText('Open My Work');
  await page.locator('.ops-sidebar a[aria-label="My Work"]').click();
  await expect(page).toHaveURL(/\/my-work$/);
  await expect(coach).toContainText('Read your tasks');
  await page.reload();
  await expect(page.getByTestId('course-lesson-title')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Resume required training' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume step 3' }).click();
  await expect(coach).toContainText('Read your tasks');
});

test('reading shift handover advances after selecting the highlighted Urgent tab', async ({ page }) => {
  await mockLogin(page);
  await page.addInitScript(user => {
    localStorage.setItem('ho-ops-structured-course-v2:' + String(user.id), JSON.stringify({
      lessonId: 'staff-handover', stage: 'quiz', question: 1, passed: ['orientation'],
    }));
  }, staff);
  await page.goto('/');
  const panel = page.getByTestId('required-training-course');
  await panel.getByLabel('Check the situation or tell the person responsible').check();
  await page.getByTestId('course-check-answer').click();
  await expect(page).toHaveURL(/\/shift$/);
  const coach = page.locator('.ops-guide-tip');
  await expect(coach).toContainText('Find urgent handovers');
  await expect(coach.getByRole('button', { name: /Click highlighted link/ })).toBeDisabled();
  await page.getByRole('tab', { name: 'Urgent' }).click();
  await expect(coach).toContainText('Read the note');
});

test('a paused guided handover resumes the stored step without pretending it is complete', async ({ page }) => {
  await mockLogin(page);
  await page.addInitScript(user => {
    localStorage.setItem('ho-ops-structured-course-v2:' + String(user.id), JSON.stringify({
      lessonId: 'staff-handover', stage: 'tour', question: 0, tourStep: 1, passed: ['orientation'],
    }));
  }, staff);
  await page.goto('/shift');
  await expect(page.getByRole('dialog', { name: 'Resume required training' })).toContainText('Your place in the lesson is saved');
  await page.getByRole('button', { name: 'Resume step 2' }).click();
  await expect(page.locator('.ops-guide-tip')).toContainText('Read the note');
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
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

test('manager must leave the taught task tour for an API-verified saved-work exercise, not a fake pass', async ({ page }) => {
  const manager = {
    ...staff, id: 92813, role: 'manager', name: 'Fictional Practice Manager',
    capabilities: { manage_department: true, make_decisions: true, view_all_operations: true },
  };
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '41');
    localStorage.setItem('ho-ops-structured-course-v2:' + String(user.id), JSON.stringify({
      lessonId: 'team-tasks', stage: 'quiz', question: 1,
      passed: ['orientation', 'staff-handover', 'staff-rooms', 'staff-my-work'],
    }));
  }, manager);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], groups: {}, counts: {}, users: [], unread_count: 0 }),
  }));
  await page.goto('/');
  const quiz = page.getByTestId('required-training-course');
  await expect(quiz).toContainText('Before creating a task');
  await quiz.getByLabel('Search for an existing task').check();
  await page.getByTestId('course-check-answer').click();
  await expect(page).toHaveURL(/\/tasks$/);
  const coach = page.locator('.ops-guide-tip');
  await expect(coach).toContainText('Board or List');
  await coach.getByRole('button', { name: /Next/ }).click();
  await coach.getByRole('button', { name: /Next/ }).click();
  await expect(coach).toContainText('Open New task');
  await expect(coach.getByRole('button', { name: /Click highlighted link/ })).toBeDisabled();
  await page.getByTestId('create-task').click();
  await expect(coach).toContainText('Describe the task');
  await coach.getByRole('button', { name: /Next/ }).click();
  await page.getByTestId('create-task-form').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('course-await-work')).toContainText('Actual-page practice');
  await expect(page.getByTestId('training-workflow-coach')).toBeVisible();
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), 'ho-ops-structured-course-v2:' + String(manager.id));
  expect(saved.stage).toBe('work');
  expect(saved.reference).toMatch(/^TRN-TASK-/);
  await page.getByTestId('repeat-real-workflow').click();
  await expect(page.getByTestId('training-workflow-message')).toContainText('Finish this practice before starting again. Your earlier results will be kept.');
  await expect(page.getByTestId('course-completed')).toHaveCount(0);
});

test('a learner can pause a question, open the guide, and resume without earning a pass', async ({ page }) => {
  await mockLogin(page);
  await page.goto('/');
  await page.getByTestId('course-start-quiz').click();
  await expect(page.getByTestId('course-quiz-question')).toContainText('Question 1');
  await page.getByRole('button', { name: 'Pause lesson' }).click();
  await expect(page.getByTestId('required-training-course')).toHaveCount(0);
  await page.getByRole('link', { name: 'Staff Guide', exact: true }).click();
  await expect(page).toHaveURL(/\/staff-guide/);
  await page.reload();
  await expect(page.getByTestId('required-training-course')).toHaveCount(0);
  await page.getByTestId('interactive-training-open').click();
  await expect(page.getByTestId('course-quiz-question')).toContainText('Question 1');
  const progress = await page.evaluate(id => JSON.parse(localStorage.getItem('ho-ops-structured-course-v2:' + id) || '{}'), staff.id);
  expect(progress.passed).toEqual([]);
});
