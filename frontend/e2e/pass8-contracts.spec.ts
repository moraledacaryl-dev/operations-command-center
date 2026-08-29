import { expect, test, type Page } from '@playwright/test';

const department = { id: 1, name: 'Front Office', is_primary: true };

const owner = {
  id: 1,
  name: 'Owner',
  role: 'owner',
  token: 'owner-token',
  primary_department_id: 1,
  departments: [department],
  capabilities: {
    view_all_operations: true,
    manage_department: true,
    make_decisions: true,
    manage_accounts: true,
    manage_system: true,
    view_system_health: true,
    manage_approvals: true,
    view_sensitive_user_metadata: true,
    view_integration_summary: true,
  },
};

const staff = {
  id: 2,
  name: 'Staff',
  role: 'staff',
  token: 'staff-token',
  primary_department_id: 1,
  departments: [department],
  capabilities: {
    view_all_operations: false,
    manage_department: false,
    make_decisions: false,
    manage_accounts: false,
    manage_system: false,
    view_system_health: false,
    manage_approvals: false,
    view_sensitive_user_metadata: false,
    view_integration_summary: false,
  },
};

const manager = {
  ...owner,
  id: 3,
  name: 'Manager',
  role: 'manager',
  token: 'manager-token',
  capabilities: {
    ...owner.capabilities,
    manage_accounts: false,
    manage_system: false,
    view_sensitive_user_metadata: false,
  },
};

async function seed(page: Page, user: Record<string, unknown>) {
  await page.addInitScript(({ session, dept }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(dept));
  }, { session: user, dept: 1 });
}

async function denyUnexpectedApi(page: Page) {
  await page.route('**/api/**', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ detail: `Unexpected API request: ${route.request().method()} ${route.request().url()}` }),
  }));
}

test('staff operational views do not advertise generic mutation controls', async ({ page }) => {
  await seed(page, staff);
  await denyUnexpectedApi(page);
  await page.route('**/api/tasks?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 10, title: 'Read-only task', status: 'To Do', priority: 'Normal', department_id: 1 }]),
  }));
  await page.route('**/api/tasks/10', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 10, title: 'Read-only task', status: 'To Do', priority: 'Normal', department_id: 1, comments: [] }),
  }));

  await page.goto('/tasks');
  await expect(page.getByText('Read-only task')).toBeVisible();
  await expect(page.getByTestId('create-tasks')).toHaveCount(0);
  await page.getByRole('button', { name: /Read-only task/i }).click();
  await expect(page.getByRole('heading', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Move workflow' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
});

test('Approvals page exposes only canonical one-time decision controls', async ({ page }) => {
  await seed(page, owner);
  await denyUnexpectedApi(page);
  const approval = { id: 21, title: 'Canonical approval', status: 'Pending', priority: 'Normal', department_id: 1, requested_by_id: 2, created_at: '2026-08-29T08:00:00Z' };
  await page.route('**/api/approvals?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([approval]) }));
  await page.route('**/api/approvals/21', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(approval) }));

  let canonicalCalled = false;
  await page.route('**/api/workflow/approvals/21/decide?status=Approved', route => {
    canonicalCalled = route.request().method() === 'POST';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approval: { ...approval, status: 'Approved' } }) });
  });

  await page.goto('/approvals');
  await expect(page.getByText('Canonical approval')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0);
  await page.getByRole('button', { name: /Canonical approval/i }).click();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => canonicalCalled).toBe(true);
});

test('Review Inbox Accept uses canonical submission decision endpoint', async ({ page }) => {
  await seed(page, manager);
  await denyUnexpectedApi(page);
  const submission = { id: 31, title: 'Inbox item', review_status: 'New', priority: 'Normal', department_id: 1, submitted_at: '2026-08-29T08:00:00Z' };
  await page.route('**/api/review/queue?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ external: [], approvals: [], submissions: [submission], posts: [], fixes: [] }),
  }));
  await page.route('**/api/submissions/31', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(submission) }));

  let canonicalCalled = false;
  await page.route('**/api/workflow/submissions/31/decide', async route => {
    canonicalCalled = route.request().method() === 'POST' && route.request().postDataJSON().status === 'Accepted';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...submission, review_status: 'Accepted' }) });
  });

  await page.goto('/review');
  await expect(page.getByText('Inbox item')).toBeVisible();
  await page.getByRole('button', { name: /Inbox item/i }).click();
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => canonicalCalled).toBe(true);
});
