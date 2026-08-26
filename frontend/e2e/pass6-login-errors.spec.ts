import { expect, test } from '@playwright/test';

const cases = [
  { status: 401, detail: 'Invalid login', expected: 'Invalid email or password.' },
  { status: 403, detail: 'Password is not set for this account yet.', expected: 'This account cannot sign in yet. Contact an administrator.' },
  { status: 429, detail: 'Too many failed sign-in attempts. Try again later.', expected: 'Too many failed sign-in attempts. Please try again later.' },
  { status: 503, detail: 'Unavailable', expected: 'The service is temporarily unavailable. Please try again.' },
];

for (const item of cases) {
  test(`login presents safe ${item.status} messaging`, async ({ page }) => {
    await page.route('**/api/auth/login', async route => {
      await route.fulfill({
        status: item.status,
        contentType: 'application/json',
        headers: item.status === 429 ? { 'Retry-After': '60' } : {},
        body: JSON.stringify({ detail: item.detail }),
      });
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill('owner@example.com');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const alert = page.locator('form p[role="alert"]');
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveText(item.expected);
    await expect(page).toHaveURL(/\/login$/);
  });
}
