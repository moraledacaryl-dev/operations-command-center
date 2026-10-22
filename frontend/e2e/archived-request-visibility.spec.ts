import { expect, test, type Page } from '@playwright/test';

const owner = {
  id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner',
  primary_department_id: 1,
  departments: [{ id: 1, name: 'Front Office', is_primary: true }],
  capabilities: { manage_department: true, view_all_operations: true, make_decisions: true },
};

const records = [
  { id: 51, title: 'Archived draft supply request', status: 'Draft', urgency: 'Urgent', department_id: 1, hidden_from_active: true, archive_reason: 'manual_archive', reason: 'Historical' },
  { id: 52, title: 'Archived request awaiting review', status: 'Review', urgency: 'Urgent', department_id: 1, hidden_from_active: true, archive_reason: 'manual_archive', reason: 'Historical' },
  { id: 53, title: 'Active reception review', status: 'Review', urgency: 'Normal', department_id: 1, hidden_from_active: false, reason: 'Needs decision' },
  { id: 54, title: 'Active equipment approval', status: 'Approved', urgency: 'Normal', department_id: 1, hidden_from_active: false, reason: 'Ready for planning' },
];

async function seed(page: Page) {
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, owner);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === '/api/auth/me') data = owner;
    else if (path === '/api/meta') data = { departments: owner.departments, users: [] };
    else if (path === '/api/notifications') data = { items: [], unread_count: 0, next_cursor: null, has_more: false };
    else if (path === '/api/requests' || path === '/api/requests/page') {
      data = path.endsWith('/page') ? { items: records, next_cursor: null, has_more: false } : records;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

test('Open and workflow tabs exclude archived Requests while All shows history', async ({ page }) => {
  await seed(page);
  await page.goto('/requests');
  await expect(page.getByRole('tab', { name: 'Open' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Active reception review/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Active equipment approval/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Archived draft supply request/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Archived request awaiting review/ })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Draft' }).click();
  await expect(page.getByRole('button', { name: /Archived draft supply request/ })).toHaveCount(0);
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: /Archived draft supply request/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Archived request awaiting review/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Active reception review/ })).toBeVisible();
});

test('archived Request detail is explicitly historical and cannot offer an action', async ({ page }) => {
  await seed(page);
  await page.goto('/requests');
  await expect(page.getByRole('tab', { name: 'Open' })).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('button', { name: /Archived draft supply request/ }).click();

  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Archived draft supply request' })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Archived request' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Send for review' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Plan implementation' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Mark implemented' })).toHaveCount(0);
  await expect(detail.getByPlaceholder('Implementation note')).toHaveCount(0);
});
