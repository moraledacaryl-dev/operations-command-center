import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ timezoneId: 'America/Los_Angeles' });

async function seed(page: Page, state: string, role = 'owner') {
  const user = { id: 1, name: 'Operator', role, departments: [{ id: 1, name: 'Front Office', is_primary: true }], capabilities: {
    view_all_operations: true, view_system_health: true, manage_department: true, make_decisions: true,
    manage_accounts: role !== 'manager', manage_system: role !== 'manager',
  } };
  await page.addInitScript(user => localStorage.setItem('cc_user', JSON.stringify(user)), user);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/recovery/offsite') {
      if (state === 'api-failure') { await route.fulfill({ status: 503, json: { detail: 'Unavailable' } }); return; }
      await route.fulfill({ json: { status: state, last_success_at: state === 'unknown' ? null : '2026-10-24T16:00:00Z' } }); return;
    }
    const body = path === '/api/auth/me' ? user : path === '/api/meta' ? { departments: user.departments }
      : path === '/api/health' ? { readiness: { ok: true, warnings: [] }, backups: { status: 'current', last_success_at: '2026-10-24T16:00:00Z' } }
      : path === '/api/notifications' ? { items: [], unread_count: 0, next_cursor: null, has_more: false } : [];
    await route.fulfill({ json: body });
  });
}

for (const width of [1440, 1024, 768, 390, 320]) {
  for (const state of ['current', 'failed', 'stale', 'unknown']) {
    test(`offsite ${state} remains distinct from current local backups at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await seed(page, state);
      await page.goto('/admin/health');
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Offsite backups', exact: true }) });
      await expect(card).toHaveAttribute('aria-busy', 'false');
      await expect(card).toContainText(state);
      if (state === 'current') await expect(card).toContainText('Hourly encrypted offsite copies are current.');
      if (state === 'failed') await expect(card).toContainText('last offsite attempt failed');
      if (state === 'stale') await expect(card).toContainText('offsite copy is overdue');
      if (state === 'unknown') await expect(card).toContainText('Not available');
      else await expect(card).toContainText(/Oct 25|25 Oct/);
      await expect(page.getByText('Hourly database and uploads backups are current.', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(axe.violations.filter(item => ['critical', 'serious'].includes(item.impact || ''))).toEqual([]);
      mkdirSync('test-results/ui-audit', { recursive: true });
      await page.screenshot({ path: `test-results/ui-audit/offsite-health-${state}-${width}.png`, fullPage: true });
    });
  }
}

test('failed offsite status request preserves local health and shows an actionable error', async ({ page }) => {
  await seed(page, 'api-failure');
  await page.goto('/admin/health');
  await expect(page.getByText('Hourly database and uploads backups are current.', { exact: true })).toBeVisible();
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Offsite backups', exact: true }) });
  await expect(card.getByRole('alert')).toHaveText('Offsite status could not be loaded. Refresh this page or ask the system operator.');
  await expect(page.getByText('Hourly encrypted offsite copies are current.', { exact: true })).toHaveCount(0);
});

test('manager sees offsite health without gaining global archive controls', async ({ page }) => {
  await seed(page, 'current', 'manager');
  await page.goto('/admin/health');
  await expect(page.getByText('Hourly encrypted offsite copies are current.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run archive', exact: true })).toHaveCount(0);
});
