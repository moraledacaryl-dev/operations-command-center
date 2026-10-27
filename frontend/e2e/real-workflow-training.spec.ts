import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type FictionalCase = Record<string, any>;
const account = {
  id: 9701, name: 'Fictional Training Manager', email: 'manager-workflow@training.invalid',
  role: 'manager', is_active: true, primary_department_id: 41,
  departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  capabilities: { manage_department: true, make_decisions: true, view_all_operations: true },
};

/** All backend responses here are test-only in-memory fictional records. */
async function prepare(page: Page) {
  const database: { guests: FictionalCase[]; tasks: FictionalCase[]; fixes: FictionalCase[]; shiftNotes: FictionalCase[]; requests: FictionalCase[] } =
    { guests: [], tasks: [], fixes: [], shiftNotes: [], requests: [] };
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '41');
  }, account);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();
    const respond = (value: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(value),
    });
    if (path === '/guests' && method === 'GET') return respond(database.guests);
    if (path === '/guests' && method === 'POST') {
      const input = route.request().postDataJSON();
      const row = { ...input, id: 501, status: 'Open', allowed_actions: ['follow-up'] };
      database.guests.push(row);
      return respond(row, 201);
    }
    if (path === '/tasks' && method === 'GET') return respond(database.tasks);
    if (path === '/tasks' && method === 'POST') {
      const input = route.request().postDataJSON();
      const row = { ...input, id: 601, status: 'To Do', allowed_actions: ['start'] };
      database.tasks.push(row);
      return respond(row, 201);
    }
    if (path === '/fixes' && method === 'GET') return respond(database.fixes);
    if (path === '/fixes' && method === 'POST') {
      const input = route.request().postDataJSON();
      const row = { ...input, id: 701, status: 'Open' };
      database.fixes.push(row);
      return respond(row, 201);
    }
    if (path === '/shift-notes' && method === 'GET') return respond(database.shiftNotes);
    if (path === '/shift-notes' && method === 'POST') {
      const input = route.request().postDataJSON();
      const row = { ...input, id: 801, status: 'New', allowed_actions: ['acknowledge', 'follow-up-new'] };
      database.shiftNotes.push(row);
      return respond(row, 201);
    }
    if (path === '/requests' && method === 'GET') return respond(database.requests);
    if (path === '/requests' && method === 'POST') {
      const input = route.request().postDataJSON();
      const row = { ...input, id: 901, status: 'Draft' };
      database.requests.push(row);
      return respond(row, 201);
    }
    if (path === '/rooms' && method === 'GET') return respond([]);
    if (path === '/meta' && method === 'GET') {
      return respond({ users: [{ id: 77, name: 'Fictional Team Lead',
        role: 'manager', departments: [{ id: 41, name: 'Front Desk' }] }] });
    }
    const detail = /^\/(guests|tasks|fixes|shift-notes|requests)\/(\d+)$/.exec(path);
    if (detail && method === 'GET') {
      const record = database[detail[1] === 'shift-notes' ? 'shiftNotes' : detail[1] as 'guests' | 'tasks' | 'fixes' | 'requests'].find(r => r.id === Number(detail[2]));
      return respond(record || { detail: 'Not found' }, record ? 200 : 404);
    }
    const action = /^\/workflow\/(guests|tasks|fixes|shift-notes|requests)\/(\d+)\/([^/]+)$/.exec(path);
    if (action && method === 'POST') {
      const record = database[action[1] === 'shift-notes' ? 'shiftNotes' : action[1] as 'guests' | 'tasks' | 'fixes'].find(r => r.id === Number(action[2]));
      if (!record) return respond({ detail: 'Not found' }, 404);
      if (action[1] === 'guests' && action[3] === 'create-fix') {
        // Simulate the backend's reciprocal GuestNote↔Fix integrity contract.
        const fix: FictionalCase = {
          id: 702, title: record.title, department_id: record.department_id,
          room_area_id: record.room_area_id, problem: record.note, urgency: record.urgency,
          status: 'Open', linked_guest_note_id: record.id,
        };
        database.fixes.push(fix);
        record.linked_fix_id = fix.id;
        record.status = 'Follow';
        return respond({ guest: record, fix });
      }
      if (action[1] === 'guests' && action[3] === 'follow-up') {
        record.status = 'Follow';
        record.allowed_actions = ['resolve-follow'];
      } else if (action[1] === 'tasks' && action[3] === 'start') {
        record.status = 'Doing';
        record.allowed_actions = ['submit-review'];
      } else if (action[1] === 'tasks' && action[3] === 'submit-review') {
        record.status = 'Review';
        record.allowed_actions = ['request-changes', 'complete'];
      } else if (action[1] === 'shift-notes' && action[3] === 'follow-up-new') {
        record.status = 'Follow';
        record.allowed_actions = ['resolve-follow'];
      } else if (action[1] === 'fixes' && action[3] === 'start') {
        record.status = 'Working';
      } else if (action[1] === 'fixes' && action[3] === 'done') {
        record.status = 'Done';
      } else if (action[1] === 'fixes' && action[3] === 'verify') {
        record.status = 'Verified';
      } else if (action[1] === 'requests' && action[3] === 'submit-approval') {
        record.status = 'Review';
      } else return respond({ detail: 'Unsupported state transition' }, 409);
      return respond(record);
    }
    if (path.startsWith('/notifications')) return respond({ unread_count: 0, items: [] });
    return respond({ counts: {}, items: [], unread_count: 0 });
  });
  return database;
}

test('Guest Matters exercise cannot pass until a real fictional case is saved and moved to Follow', async ({ page }) => {
  const database = await prepare(page);
  await page.goto('/training');
  await page.getByTestId('scenario-guest-ac').click();
  await page.getByTestId('start-real-workflow').click();
  await expect(page).toHaveURL(/\/guests/);
  await expect(page.getByTestId('training-workflow-coach')).toBeVisible();
  const reference = (await page.getByTestId('training-workflow-reference').textContent())!.trim();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-message')).toContainText('No saved record');

  await page.getByTestId('create-guest').click();
  const form = page.getByTestId('create-guest-form');
  await form.getByLabel('Matter').fill('Room 205 warm AC ' + reference);
  await form.getByLabel('Type').selectOption('Room');
  await form.getByLabel('Urgency').selectOption('High');
  await form.getByLabel('Recovery action / context').fill(
    'The AC blows warm air; Maintenance must inspect the problem and Front Desk will update the fictional guest.',
  );
  await form.getByRole('button', { name: 'Save matter' }).click();
  await expect.poll(() => database.guests.length).toBe(1);
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 2 of 2');

  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-message')).toContainText('not in Needs follow-up');
  await page.getByText('Room 205 warm AC ' + reference).first().click();
  await page.getByRole('button', { name: 'Needs follow-up' }).click();
  await expect.poll(() => database.guests[0]?.status).toBe('Follow');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('All required record changes were verified');
  const result = await page.evaluate(() => {
    const key = 'ho-ops-workflow-results-v1:9701';
    return JSON.parse(localStorage.getItem(key) || '{}');
  });
  expect(result['guest-ac'].recordId).toBe(501);
  expect(result['guest-ac'].steps).toHaveLength(2);
});

test('Task exercise verifies High/assigned, then Doing, then Review via actual saved API state', async ({ page }) => {
  const database = await prepare(page);
  await page.goto('/training');
  await page.getByTestId('scenario-shared-no-owner').click();
  await page.getByTestId('start-real-workflow').click();
  await expect(page).toHaveURL(/\/tasks/);
  const reference = (await page.getByTestId('training-workflow-reference').textContent())!.trim();

  await page.getByTestId('create-task').click();
  const form = page.getByTestId('create-task-form');
  await form.getByLabel('Task title').fill('Arrange guest follow-up ' + reference);
  await form.getByLabel('Priority').selectOption('High');
  await form.getByLabel('Assigned to').selectOption('77');
  await form.getByRole('button', { name: 'Create task' }).click();
  await expect.poll(() => database.tasks.length).toBe(1);
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 2 of 3');

  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-message')).toContainText('must be in Doing');
  await page.getByText('Arrange guest follow-up ' + reference).first().click();
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect.poll(() => database.tasks[0]?.status).toBe('Doing');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 3 of 3');

  await page.getByText('Arrange guest follow-up ' + reference).first().click();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect.poll(() => database.tasks[0]?.status).toBe('Review');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('All required record changes were verified');
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('ho-ops-workflow-results-v1:9701') || '{}'));
  expect(result['shared-no-owner'].recordId).toBe(601);
  expect(result['shared-no-owner'].steps).toHaveLength(3);
});


test('Shift Handover requires published record and actual Carry forward transition', async ({ page }) => {
  const database = await prepare(page);
  await page.goto('/training');
  await page.getByTestId('scenario-shift-unresolved').click();
  await page.getByTestId('start-real-workflow').click();
  await expect(page).toHaveURL(/\/shift/);
  const ref = (await page.getByTestId('training-workflow-reference').textContent())!.trim();
  await page.getByTestId('create-shift').click();
  const form = page.getByTestId('create-shift-form');
  await form.getByLabel('Title').fill('Unresolved guest promise ' + ref);
  await form.getByLabel('Category').selectOption('Guest');
  await form.getByLabel('Priority').selectOption('Urgent');
  await form.getByLabel('Handover detail').fill(
    'The guest is waiting for a call; the on-duty Front Desk lead is the responsible owner and will update the guest after checking progress.',
  );
  await form.getByRole('button', { name: 'Publish handover' }).click();
  await expect.poll(() => database.shiftNotes.length).toBe(1);
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 2 of 2');
  await page.getByText('Unresolved guest promise ' + ref).first().click();
  await page.getByRole('button', { name: 'Carry forward' }).click();
  await expect.poll(() => database.shiftNotes[0]?.status).toBe('Follow');
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('All required record changes were verified');
});

test('Maintenance exercise checks saved technician, urgency and all four workflow stages', async ({ page }) => {
  const database = await prepare(page);
  await page.goto('/training');
  await page.getByTestId('scenario-mt-light-fault').click();
  await page.getByTestId('start-real-workflow').click();
  await expect(page).toHaveURL(/\/fixes/);
  const ref = (await page.getByTestId('training-workflow-reference').textContent())!.trim();

  await page.getByTestId('create-fix').click();
  const form = page.getByTestId('create-fix-form');
  await form.getByLabel('Work item').fill('Repair corridor light ' + ref);
  await form.getByLabel('Urgency').selectOption('High');
  await form.getByLabel('Assigned technician').selectOption('77');
  await form.getByLabel('Problem / scope').fill('The corridor light is not turning on and leaves the hallway too dark.');
  await form.getByRole('button', { name: 'Create work item' }).click();
  await expect.poll(() => database.fixes.length).toBe(1);
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 2 of 4');

  await page.getByText('Repair corridor light ' + ref).first().click();
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect.poll(() => database.fixes[0]?.status).toBe('Working');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 3 of 4');

  await page.getByText('Repair corridor light ' + ref).first().click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect.poll(() => database.fixes[0]?.status).toBe('Done');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 4 of 4');

  await page.getByText('Repair corridor light ' + ref).first().click();
  await page.getByPlaceholder('Verification note').fill(
    'Fictional hallway lamp inspected and switch cycle confirmed, no exposed wires observed. Training data only.',
  );
  await page.getByRole('button', { name: 'Verify work' }).click();
  await expect.poll(() => database.fixes[0]?.status).toBe('Verified');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('All required record changes were verified');
});

test('Manager equipment request exercise checks documentary controls and only Review status, not approval', async ({ page }) => {
  const database = await prepare(page);
  await page.goto('/training');
  await page.getByTestId('scenario-manager-evidence').click();
  await page.getByTestId('start-real-workflow').click();
  await expect(page).toHaveURL(/\/requests/);
  const ref = (await page.getByTestId('training-workflow-reference').textContent())!.trim();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-message')).toContainText('No saved record');

  await page.getByTestId('create-request').click();
  const form = page.getByTestId('create-request-form');
  await form.getByLabel('Request').fill('Repair equipment replacement ' + ref);
  await form.getByLabel('Type').selectOption('Equipment');
  await form.getByLabel('Priority').selectOption('Urgent');
  await form.getByLabel('Business reason').fill(
    'Emergency kitchen equipment is operationally necessary. Estimated cost PHP 12000; supplier quotation pending confirmation. No quotation is attached yet.',
  );
  await form.getByRole('button', { name: 'Create draft' }).click();
  await expect.poll(() => database.requests.length).toBe(1);
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 2 of 2');

  await page.getByText('Repair equipment replacement ' + ref).first().click();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect.poll(() => database.requests[0]?.status).toBe('Review');
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('All required record changes were verified');
  expect(database.requests[0].status).not.toBe('Approved');
});

test('real linked Guest-to-Maintenance handoff requires both reciprocal links and all fix transitions', async ({ page }) => {
  const database = await prepare(page);
  await page.goto('/training');
  await page.getByTestId('scenario-fd-broken-shower').click();
  await page.getByTestId('start-real-workflow').click();
  await expect(page).toHaveURL(/\/guests/);
  const ref = (await page.getByTestId('training-workflow-reference').textContent())!.trim();
  await page.getByTestId('create-guest').click();
  const form = page.getByTestId('create-guest-form');
  await form.getByLabel('Matter').fill('Room 210 shower fault ' + ref);
  await form.getByLabel('Type').selectOption('Room');
  await form.getByLabel('Urgency').selectOption('High');
  await form.getByLabel('Recovery action / context').fill(
    'Room 210 shower has no hot water. Maintenance must inspect before Front Desk calls the guest with an update.',
  );
  await form.getByRole('button', { name: 'Save matter' }).click();
  await expect.poll(() => database.guests.length).toBe(1);
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 2 of 5');

  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-message')).toContainText('not yet linked');
  await page.getByText('Room 210 shower fault ' + ref).first().click();
  await page.getByRole('button', { name: 'Create maintenance' }).click();
  await expect.poll(() => database.guests[0]?.linked_fix_id).toBe(702);
  await expect.poll(() => database.fixes[0]?.linked_guest_note_id).toBe(501);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 3 of 5');

  await page.getByTestId('training-open-module').click();
  await expect(page).toHaveURL(/\/fixes/);
  await page.getByText('Room 210 shower fault ' + ref).first().click();
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 4 of 5');

  await page.getByText('Room 210 shower fault ' + ref).first().click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 5 of 5');

  await page.getByText('Room 210 shower fault ' + ref).first().click();
  await page.getByPlaceholder('Verification note').fill(
    'Training only: fictional shower water supply and temperature controls tested. Guest callback remains separately open.',
  );
  await page.getByRole('button', { name: 'Verify work' }).click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('training-check-work').click();
  await expect(page.getByTestId('training-workflow-coach')).toContainText('All required record changes were verified');
  expect(database.guests[0].status).toBe('Follow');
  expect(database.fixes[0].status).toBe('Verified');
  const result = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ho-ops-workflow-results-v1:9701') || '{}'));
  expect(result['fd-broken-shower']).toMatchObject({ recordId: 501, relatedRecordId: 702 });

  await page.goto('/training');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my results (CSV)' }).click();
  const exported = await downloadEvent;
  expect(exported.suggestedFilename()).toContain('training-progress.csv');
  const csvPath = await exported.path();
  expect(csvPath).toBeTruthy();
  const csv = readFileSync(csvPath!, 'utf8');
  expect(csv).toContain('"hands-on-workflow","fd-broken-shower"');
  expect(csv).toContain('"501","702"');
});
