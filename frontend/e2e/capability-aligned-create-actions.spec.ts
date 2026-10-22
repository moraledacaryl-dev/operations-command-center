import { expect, test, type Page } from '@playwright/test';

const base = {
  id: 21, name: 'Operational user', email: 'user@example.test',
  primary_department_id: 1,
  departments: [{ id: 1, name: 'Front Office', is_primary: true }],
};
const staff = {
  ...base,
  role: 'staff',
  capabilities: { manage_department: false, make_decisions: false, view_all_operations: false },
};
const lead = {
  ...base,
  id: 22, role: 'lead',
  capabilities: { manage_department: true, make_decisions: false, view_all_operations: false },
};

async function mockSession(page: Page, user: typeof staff) {
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, user);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let response: unknown = [];
    if (path === '/api/auth/me') response = user;
    else if (path === '/api/meta') response = { departments: user.departments, users: [] };
    else if (path === '/api/dashboard') response = { counts: { approve: 0, fixes: 0 }, approvals: [], previous_shift: [] };
    else if (path === '/api/my-work') response = { groups: { overdue: [], today: [], upcoming: [], waiting: [] } };
    else if (path === '/api/notifications') response = { items: [], unread_count: 0, has_more: false, next_cursor: null };
    else if (path.endsWith('/page')) response = { items: [], next_cursor: null, has_more: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
}

test('staff home offers accessible read-only navigation, not forbidden creation shortcuts', async ({ page }) => {
  await mockSession(page, staff);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  const shortcuts = page.locator('.today-shortcuts');
  await expect(shortcuts.getByRole('link', { name: /My work/ })).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: /View handover/ })).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: /Report issue|New request/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'New task' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Add a shift note/ })).toHaveCount(0);
});

const deniedCreatePages = [
  { path: '/tasks?create=1', testId: 'create-task', form: 'Create team task' },
  { path: '/requests?create=1', testId: 'create-request', form: 'New request' },
  { path: '/fixes?create=1', testId: 'create-fix', form: 'Log maintenance work' },
  { path: '/guests?create=1', testId: 'create-guest', form: 'New guest matter' },
  { path: '/shift?create=1', testId: 'create-shift', form: 'New handover' },
] as const;

for (const entry of deniedCreatePages) {
  test(`staff deep link ${entry.path} does not expose forbidden create form`, async ({ page }) => {
    await mockSession(page, staff);
    await page.goto(entry.path);
    await expect(page.locator('.ops-module')).toBeVisible();
    await expect(page.getByTestId(entry.testId)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: entry.form })).toHaveCount(0);
  });
}

test('department lead retains quick actions and deep-linked creation', async ({ page }) => {
  await mockSession(page, lead);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'New task' })).toBeVisible();
  await expect(page.locator('.today-shortcuts').getByRole('link', { name: 'New request' })).toBeVisible();
  await page.goto('/tasks?create=1');
  await expect(page.getByTestId('create-task')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create team task' })).toBeVisible();
});
