import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const owner = {
  id: 1,
  name: 'Owner',
  email: 'owner@example.test',
  role: 'owner',
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

const media = [
  { slot: 'login_background', label: 'Login background', configured: false, filename: null, content_url: null },
  { slot: 'dashboard_hero', label: 'Dashboard hero', configured: true, filename: 'hero.webp', content_url: '/api/property-media/dashboard_hero/content' },
  { slot: 'property_cover', label: 'Property cover', configured: false, filename: null, content_url: null },
  { slot: 'room_placeholder', label: 'Default room placeholder', configured: false, filename: null, content_url: null },
];

test.beforeAll(() => mkdirSync('test-results/ui-audit', { recursive: true }));

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`owner can reach property media at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(session => {
      localStorage.setItem('cc_user', JSON.stringify(session));
      localStorage.setItem('cc_department_id', '1');
    }, owner);

    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/property-media') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(media) });
        return;
      }
      if (url.pathname.includes('/api/property-media/') && url.pathname.endsWith('/content')) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return;
      }
      if (url.pathname === '/api/notifications') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], next_cursor: null, has_more: false, unread_count: 0 }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/admin/appearance');
    await expect(page.getByRole('heading', { name: 'Appearance & property media' })).toBeVisible();
    await expect(page.getByText('Login background', { exact: true })).toBeVisible();
    await expect(page.getByText('Dashboard hero', { exact: true })).toBeVisible();
    await expect(page.getByText('Property cover', { exact: true })).toBeVisible();
    await expect(page.getByText('Default room placeholder', { exact: true })).toBeVisible();
    await expect(page.getByText('Replace image', { exact: true })).toBeVisible();

    await page.screenshot({ path: `test-results/ui-audit/site-owner-${viewport.name}-admin--appearance.png`, fullPage: true });
  });
}
