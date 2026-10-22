import { expect, test, type Page } from '@playwright/test';

const owner = {
  id: 1, name: 'Owner', role: 'owner',
  primary_department_id: 1,
  departments: [{ id: 1, name: 'Front Office', is_primary: true }],
  capabilities: { make_decisions: true, manage_approvals: true, view_all_operations: true },
};

const approvals = [
  { id: 41, title: 'Archived pending approval', status: 'Pending', hidden_from_active: true, department_id: 1, priority: 'Urgent', archive_reason: 'manual_archive' },
  { id: 42, title: 'Active pending approval', status: 'Pending', hidden_from_active: false, department_id: 1, priority: 'Normal' },
  { id: 43, title: 'Archived approved decision', status: 'Approved', hidden_from_active: true, department_id: 1, priority: 'Normal' },
  { id: 44, title: 'Active approved decision', status: 'Approved', hidden_from_active: false, department_id: 1, priority: 'Normal' },
];

async function mockApprovals(page: Page) {
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, owner);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === '/api/auth/me') body = owner;
    else if (path === '/api/meta') body = { departments: owner.departments, users: [] };
    else if (path === '/api/notifications') body = { items: [], unread_count: 0, next_cursor: null, has_more: false };
    else if (path === '/api/approvals') body = approvals;
    else if (path === '/api/approvals/page') body = { items: approvals, next_cursor: null, has_more: false };
    else if (path.startsWith('/api/approvals/')) body = approvals.find(a => String(a.id) === path.split('/').at(-1)) || {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('Pending and Approved tabs hide archived approvals, All exposes history', async ({ page }) => {
  await mockApprovals(page);
  await page.goto('/approvals');
  await expect(page.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Active pending approval/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Archived pending approval/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Approved' }).click();
  await expect(page.getByRole('button', { name: /Active approved decision/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Archived approved decision/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: /Archived pending approval/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Archived approved decision/ })).toBeVisible();
});

test('archived pending approval is explicitly historical and has no decision controls', async ({ page }) => {
  await mockApprovals(page);
  await page.goto('/approvals');
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('button', { name: /Archived pending approval/ }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Archived pending approval' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Archived approval' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
  await expect(drawer.getByPlaceholder(/Decision note/)).toHaveCount(0);
});
