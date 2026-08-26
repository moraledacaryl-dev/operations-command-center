import { expect, test, type Page } from '@playwright/test';

const owner = {
  id: 1,
  name: 'Owner Test',
  email: 'owner@example.test',
  role: 'owner',
  token: 'test-token',
  departments: [
    { id: 1, name: 'Front Office', is_primary: true },
    { id: 2, name: 'Maintenance', is_primary: false },
  ],
};

async function seedSession(page: Page, departmentId = 1) {
  await page.addInitScript(({ user, dept }) => {
    window.localStorage.setItem('cc_user', JSON.stringify(user));
    window.localStorage.setItem('cc_department_id', String(dept));
  }, { user: owner, dept: departmentId });
}

async function assertSession(page: Page, departmentId = 1) {
  const seeded = await page.evaluate(() => ({
    user: window.localStorage.getItem('cc_user'),
    dept: window.localStorage.getItem('cc_department_id'),
  }));

  expect(seeded.user).not.toBeNull();
  expect(seeded.dept).toBe(String(departmentId));
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.locator('#operations-app-root')).toBeVisible();
}

async function mockCommon(page: Page) {
  // Keep the browser suite hermetic. Any API call that a test has not
  // explicitly modeled must not reach the real backend with the synthetic
  // bearer token, because a real 401 intentionally clears the browser
  // session and redirects to /login.
  await page.route('**/api/**', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ detail: `Unmocked E2E API route: ${route.request().url()}` }),
  }));

  await page.route('**/api/meta', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ departments: owner.departments, users: [] }),
  }));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(owner),
  }));
}

test('mobile Drawer is portaled, traps focus, hides background nav, and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSession(page);
  await mockCommon(page);
  await page.route('**/api/tasks?*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 11, title: 'Drawer probe', status: 'To Do', priority: 'Normal', department_id: 1 }]),
  }));

  await page.goto('/tasks');
  await assertSession(page);
  const opener = page.getByRole('button', { name: /Drawer probe/i });
  await expect(opener).toBeVisible();
  await opener.focus();
  await opener.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#operations-app-root')).toHaveAttribute('inert', '');
  await expect(page.locator('.mobile-bottom-nav')).toHaveCSS('display', 'none');

  const close = page.getByRole('button', { name: 'Close details' });
  await expect(close).toBeFocused();

  const box = await close.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);

  await page.keyboard.press('Shift+Tab');
  await expect(dialog).toContainText('Move task');
  const activeInsideDialog = await page.evaluate(() => {
    const dialogNode = document.querySelector('[role="dialog"]');
    return !!dialogNode && dialogNode.contains(document.activeElement);
  });
  expect(activeInsideDialog).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator('#operations-app-root')).not.toHaveAttribute('inert', '');
});

test('quick-create is declarative and Tasks render four desktop columns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSession(page);
  await mockCommon(page);
  await page.route('**/api/tasks?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('/tasks?create=1');
  await assertSession(page);
  await expect(page.getByRole('heading', { name: 'Create team task' })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);

  const board = page.getByTestId('tasks-board');
  const columnCount = await board.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
  expect(columnCount).toBe(4);
});

test('People & Access uses protected directory account state', async ({ page }) => {
  await seedSession(page);
  await mockCommon(page);
  await page.route('**/api/users', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 7,
      name: 'Active Manager',
      email: 'manager@example.test',
      role: 'manager',
      is_active: true,
      last_login_at: '2026-08-26T08:00:00Z',
      departments: [{ id: 1, name: 'Front Office', is_primary: true }],
    }]),
  }));

  await page.goto('/admin/users');
  await assertSession(page);
  await expect(page.getByText('Active Manager')).toBeVisible();
  await expect(page.getByText('manager@example.test')).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText(/Last login:/)).not.toContainText('Never');
});

test('logout calls server endpoint, clears local session, and redirects', async ({ page }) => {
  await seedSession(page);
  await mockCommon(page);
  await page.route('**/api/tasks?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  let logoutCalled = false;
  await page.route('**/api/auth/logout', async route => {
    logoutCalled = route.request().method() === 'POST';
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/tasks');
  await assertSession(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(logoutCalled).toBe(true);
  const stored = await page.evaluate(() => ({
    user: localStorage.getItem('cc_user'),
    dept: localStorage.getItem('cc_department_id'),
  }));
  expect(stored.user).toBeNull();
  expect(stored.dept).toBeNull();
});

test('rapid department switching ignores stale old-department response', async ({ page }) => {
  await seedSession(page, 1);
  await mockCommon(page);

  await page.route('**/api/tasks?*', async route => {
    const url = new URL(route.request().url());
    const dept = url.searchParams.get('department_id');
    if (dept === '1') {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, title: 'STALE FRONT OFFICE TASK', status: 'To Do', priority: 'Normal', department_id: 1 }]),
      });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 2, title: 'CURRENT MAINTENANCE TASK', status: 'To Do', priority: 'Normal', department_id: 2 }]),
    });
  });

  await page.goto('/tasks');
  await assertSession(page, 1);
  const selector = page.locator('.dept-switch select');
  await expect(selector).toBeVisible();
  await selector.selectOption('2');

  await expect(page.getByText('CURRENT MAINTENANCE TASK')).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByText('STALE FRONT OFFICE TASK')).toHaveCount(0);
  await expect(page.getByText('CURRENT MAINTENANCE TASK')).toBeVisible();
});
