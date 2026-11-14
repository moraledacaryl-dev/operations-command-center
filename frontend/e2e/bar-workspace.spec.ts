import { expect, test, type Page } from '@playwright/test';
import { TRAINING_LESSONS } from '../lib/interactive-training';

type Member = { id: number; name: string; is_primary: boolean };
const departments: Member[] = [{ id: 8, name: 'Bar', is_primary: true }];
const base = { id: 31, name: 'Demo Bartender', email: 'bartender@training.invalid', role: 'staff',
  primary_department_id: 8, departments, capabilities: { manage_department: false, view_all_operations: false, manage_accounts: false, make_decisions: false } };
const lead = { ...base, id: 32, name: 'Demo Bar lead', role: 'lead', capabilities: { ...base.capabilities, manage_department: true } };
const cafe = { ...base, id: 33, name: 'Demo Café staff', primary_department_id: 9,
  departments: [{ id: 9, name: 'Café', is_primary: true }] };
const starting = { id: 71, title: 'Mango syrup is low', department_id: 8, status: 'New',
  urgency: 'Normal', category: 'Low stock', note: 'Please count bottles before the next shift.', allowed_actions: ['acknowledge'] };

async function serveBar(page: Page, user: typeof base) {
  const notes = [{ ...starting }];
  const tasks: any[] = [];
  const submissions: any[] = [];
  await page.addInitScript(({ session, passed }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(session.primary_department_id));
    // Exercise the workspace after completion of this fictional user's lessons.
    localStorage.setItem('ho-ops-structured-course-v2:' + session.id,
      JSON.stringify({ lessonId: 'orientation', stage: 'finished', question: 0, passed }));
  }, { session: user, passed: TRAINING_LESSONS.map(lesson => lesson.id) });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    let result: any = [];
    if (url.pathname === '/api/auth/me') result = user;
    else if (url.pathname === '/api/meta') result = { users: [base, lead, cafe], departments: user.departments };
    else if (url.pathname === '/api/shift-notes') result = notes;
    else if (url.pathname === '/api/shift-notes/71') result = notes.find(note => note.id === 71);
    else if (url.pathname === '/api/tasks') result = tasks;
    else if (url.pathname === '/api/bar/reports/71/task' && method === 'POST') {
      const data = route.request().postDataJSON();
      const task = { id: 801, title: starting.title, status: 'To Do', assigned_to_id: data.assigned_to_id };
      tasks.push(task);
      Object.assign(notes.find(note => note.id === 71)!, { linked_task_id: task.id });
      result = { task, created: true };
    }
    else if (url.pathname === '/api/bar/reports' && method === 'POST') {
      const data = route.request().postDataJSON();
      submissions.push(data);
      notes.unshift({ id: 72, ...data, category: data.kind, department_id: 8, status: 'New' });
      result = notes[0];
    }
    else if (url.pathname === '/api/shift-notes/71/comments' && method === 'POST') result = { id: 1 };
    else if (url.pathname === '/api/workflow/shift-notes/71/acknowledge') {
      result = { ...starting, status: 'Seen', allowed_actions: [] };
    }
    else if (url.pathname === '/api/notifications') result = { items: [], unread_count: 0, has_more: false, next_cursor: null };
    else if (url.pathname.endsWith('/page')) result = { items: [], has_more: false, next_cursor: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return { notes, submissions, tasks };
}

test('Bar staff can create a problem report with plain words and no management controls', async ({ page }) => {
  const { submissions } = await serveBar(page, base);
  await page.goto('/bar');
  await expect(page.getByTestId('bar-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bar tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Opening checks' })).toHaveCount(0);
  await page.getByTestId('bar-open-report').click();
  await expect(page.getByRole('button', { name: 'Save Bar report' })).toBeDisabled();
  await page.getByPlaceholder('Example: Mocktail blender stopped working').fill('Blender is broken');
  await page.getByLabel('Type of report').selectOption('Equipment');
  await page.getByLabel('Your shift (optional)').selectOption('PM');
  await page.getByPlaceholder('Where is the problem? What have you done? Who needs to check it next?')
    .fill('Stopped using the blender. Bar lead should have it checked.');
  await page.getByTestId('bar-save-report').click();
  await expect(page.getByText('Bar report saved. The team can now see it.')).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ kind: 'Equipment', shift: 'PM', title: 'Blender is broken' });
  expect(submissions[0]).not.toHaveProperty('department_id');
  expect(submissions[0]).not.toHaveProperty('assigned_to_id');
  await expect(page.getByText('Blender is broken')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Bar routines' })).toHaveCount(0);
  await page.getByRole('button', { name: /Mango syrup is low/ }).click();
  await expect(page.getByTestId('bar-report-details').getByRole('button', { name: 'Assign task' })).toHaveCount(0);
});

test('Café-only employee is not offered Bar work or its report button', async ({ page }) => {
  await serveBar(page, cafe);
  await page.goto('/bar');
  await expect(page.getByText('Bar access needed')).toBeVisible();
  await expect(page.getByTestId('bar-open-report')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Bar', exact: true })).toHaveCount(0);
});

test('Bar lead can see current handovers and existing task follow-up', async ({ page }) => {
  await serveBar(page, lead);
  await page.goto('/bar');
  await page.getByRole('button', { name: /Mango syrup is low/ }).click();
  await expect(page.getByTestId('bar-report-details')).toContainText('Please count bottles before the next shift.');
  await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'See tasks' })).toBeVisible();
});

test('Bar lead assigns a report to a Bar teammate and sees the linked task', async ({ page }) => {
  const { tasks, notes } = await serveBar(page, lead);
  await page.goto('/bar');
  await page.getByRole('button', { name: /Mango syrup is low/ }).click();
  const details = page.getByTestId('bar-report-details');
  const select = details.getByLabel('Who should handle this?');
  await expect(select.getByRole('option', { name: 'Demo Café staff' })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Assign task' })).toBeDisabled();
  await select.selectOption('31');
  await details.getByRole('button', { name: 'Assign task' }).click();
  await expect(page.getByText('Task assigned. The team member can find it in My Work.')).toBeVisible();
  await expect(details).toContainText('This report has a linked task');
  await expect(details).toContainText('To Do · Assigned to Demo Bartender');
  await expect(details.getByRole('button', { name: 'Assign task' })).toHaveCount(0);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].assigned_to_id).toBe(31);
  expect(notes[0]).toMatchObject({ linked_task_id: 801 });
  await page.reload();
  await page.getByRole('button', { name: /Mango syrup is low/ }).click();
  await expect(page.getByTestId('bar-report-details')).toContainText('This report has a linked task');
});
