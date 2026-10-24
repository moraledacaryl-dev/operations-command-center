import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ timezoneId: 'America/Los_Angeles' });
for (const width of [1440, 1024, 768, 390, 320]) {
  for (const status of ['current', 'failed', 'stale', 'unknown']) {
    test(`backup ${status} is clear and accessible at ${width}px`, async ({ page }) => {
      const user = { id: 1, name: 'Operator', role: 'owner', departments: [{ id: 1, name: 'Front Office', is_primary: true }], capabilities: {
        view_all_operations: true, view_system_health: true, manage_department: true, make_decisions: true,
        manage_accounts: true, manage_system: true, manage_approvals: true, view_sensitive_user_metadata: true,
      } };
      await page.setViewportSize({ width, height: ({1440:1000,1024:900,768:1024,390:844,320:720} as Record<number,number>)[width] });
      await page.addInitScript(user => localStorage.setItem('cc_user', JSON.stringify(user)), user);
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const body = path === '/api/auth/me' ? user
          : path === '/api/meta' ? { departments: user.departments, users: [user] }
          : path === '/api/health' ? { readiness: { ok: true, warnings: [] }, backups: { status, last_success_at: status === 'unknown' ? null : '2026-10-24T16:00:00+00:00', last_attempt_status: status === 'failed' ? 'failed' : 'ok' } }
          : path === '/api/notifications' ? { items: [], unread_count: 0, next_cursor: null, has_more: false }
          : path === '/api/property-media' ? [] : {};
        await route.fulfill({ status: 200, json: body });
      });
      await page.goto('/admin/health');
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Backups', exact: true }) });
      await expect(card).toContainText(status);
      if (status === 'current') await expect(card).toContainText('backups are current');
      if (status === 'failed') await expect(card).toContainText('last backup attempt failed');
      if (status === 'stale') await expect(card).toContainText('backup is overdue');
      if (status === 'unknown') await expect(card).toContainText('Not available');
      else await expect(card).toContainText(/Oct 25|25 Oct/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(axe.violations.filter(v => ['critical','serious'].includes(v.impact || ''))).toEqual([]);
      mkdirSync('test-results/ui-audit', { recursive: true });
      await page.screenshot({ path: `test-results/ui-audit/backup-health-${status}-${width}.png`, fullPage: true });
    });
  }
}
