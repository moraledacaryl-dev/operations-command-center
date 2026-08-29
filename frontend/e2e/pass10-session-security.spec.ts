import { expect, test } from '@playwright/test';

const loginUser = {
  id: 91,
  name: 'Cookie Owner',
  email: 'cookie-owner@example.test',
  role: 'owner',
  token: 'must-never-reach-local-storage',
  primary_department_id: 1,
  departments: [{ id: 1, name: 'Front Office', is_primary: true }],
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

test('successful browser login persists metadata only and uses cookie transport', async ({ page }) => {
  const protectedHeaders: Array<{ authorization?: string; cookie?: string }> = [];

  await page.route('**/api/auth/login', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Set-Cookie': 'operations_session=test-cookie; Path=/; HttpOnly; Secure; SameSite=Lax',
      },
      body: JSON.stringify(loginUser),
    });
  });

  await page.route('**/api/dashboard?*', async route => {
    protectedHeaders.push(route.request().headers());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ counts: {}, approvals: [], previous_shift: [] }),
    });
  });
  await page.route('**/api/my-work?*', async route => {
    protectedHeaders.push(route.request().headers());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ groups: { overdue: [], today: [], waiting: [], upcoming: [] } }),
    });
  });
  await page.route('**/api/integrations/overview', async route => {
    protectedHeaders.push(route.request().headers());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('cookie-owner@example.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/Good (morning|afternoon|evening), Cookie/)).toBeVisible();

  const browserStorage = await page.evaluate(() => ({
    user: JSON.parse(localStorage.getItem('cc_user') || '{}'),
    sessionValue: localStorage.getItem('operations_session'),
  }));
  expect(browserStorage.user.id).toBe(91);
  expect(browserStorage.user.token).toBeUndefined();
  expect(browserStorage.sessionValue).toBeNull();

  await expect.poll(() => protectedHeaders.length).toBeGreaterThan(0);
  for (const headers of protectedHeaders) {
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toContain('operations_session=test-cookie');
  }
});
