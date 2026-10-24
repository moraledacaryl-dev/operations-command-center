import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Role = 'owner' | 'admin' | 'manager';
async function seed(page: Page, role: Role) {
  const user = { id: 1, name: 'Operator', email: 'operator@example.test', role, departments: [{ id: 1, name: 'Front Office', is_primary: true }], capabilities: {
    view_all_operations: true, view_system_health: true, manage_department: true, make_decisions: true,
    manage_accounts: role !== 'manager', manage_system: role !== 'manager', manage_approvals: true,
    view_sensitive_user_metadata: role !== 'manager', view_integration_summary: true,
  } };
  await page.addInitScript(user => localStorage.setItem('cc_user', JSON.stringify(user)), user);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === '/api/auth/me') body = user;
    else if (path === '/api/meta') body = { departments: user.departments, users: [user] };
    else if (path === '/api/health') body = { readiness: { ok: true, warnings: [] } };
    else if (path === '/api/notifications') body = { items: [], unread_count: 0, next_cursor: null, has_more: false };
    else if (path === '/api/property-media') body = [];
    await route.fulfill({ status: 200, json: body });
  });
}

for (const width of [1440, 1024, 768, 390, 320]) {
  for (const role of ['owner', 'admin', 'manager'] as const) {
    test(`${role} archive policy and accessible Health at ${width}px`, async ({ page }) => {
      const height = ({ 1440: 1000, 1024: 900, 768: 1024, 390: 844, 320: 720 } as Record<number, number>)[width];
      await page.setViewportSize({ width, height });
      await seed(page, role);
      await page.goto('/admin/health');
      await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
      const button = page.getByRole('button', { name: 'Run archive', exact: true });
      if (role === 'manager') await expect(button).toHaveCount(0);
      else await expect(button).toBeVisible();
      await expect(page.getByText('Records remain available there.', { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
      mkdirSync('test-results/ui-audit', { recursive: true });
      await page.screenshot({ path: `test-results/ui-audit/archive-policy-${role}-${width}.png`, fullPage: true });
    });
  }
}

test('an archive request stays disabled while pending and reports safe result counts', async ({ page }) => {
  await seed(page, 'owner');
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/auto-archive/run', async route => {
    calls++;
    await pending;
    await route.fulfill({ status: 200, json: { tasks: 2, projects: 0 } });
  });
  await page.goto('/admin/health');
  await page.getByRole('button', { name: 'Run archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archiving…' })).toBeDisabled();
  expect(calls).toBe(1);
  release();
  await expect(page.getByRole('status')).toContainText('tasks: 2');
  await expect(page.getByRole('button', { name: 'Run archive', exact: true })).toBeEnabled();
});

test('a revoked archive permission is shown as an error without a success result', async ({ page }) => {
  await seed(page, 'admin');
  let calls = 0;
  await page.route('**/api/auto-archive/run', route => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 200, json: { tasks: 1 } })
      : route.fulfill({ status: 403, json: { detail: 'Owner/Admin access required' } });
  });
  await page.goto('/admin/health');
  await page.getByRole('button', { name: 'Run archive', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('tasks: 1');
  await page.getByRole('button', { name: 'Run archive', exact: true }).click();
  await expect(page.locator('.admin-health').getByRole('alert')).toContainText('Owner/Admin access required');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run archive', exact: true })).toBeEnabled();
});
