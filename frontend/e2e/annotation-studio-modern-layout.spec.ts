import { expect, test, type Page } from '@playwright/test';

const departments = [{ id: 3, name: 'Marketing', is_primary: true }];
const owner = { id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner', primary_department_id: 3, departments, capabilities: { view_all_operations: true, manage_department: true, make_decisions: true, manage_accounts: true, manage_system: true, view_system_health: true, manage_approvals: true, view_sensitive_user_metadata: true, view_integration_summary: true } };
const campaign = { id: 41, department_id: 3, name: 'September Escape', objective: 'Drive direct bookings' };
const concept = { id: 51, campaign_id: 41, title: 'Poolside weekend', content_pillar: 'Stay', brief: 'One concept for multiple channels', campaign, deliverables: [] };
const version = { id: 91, asset_id: 81, version_no: 1, filename: 'pool-hero.png', mime_type: 'image/png', annotatable: true, file_url: '/api/marketing/assets/81/versions/91/download' };
const basePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAIAAAA48Cq8AAABTElEQVR4nO3SwQ3AIBDAsNL9dz6WIEJC9gR5ZM3MB6f9twN4k7FIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi8QGNfcD7QNqWV8AAAAASUVORK5CYII=', 'base64');

async function seed(page: Page) {
  await page.addInitScript(({ session }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '3');
  }, { session: owner });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/marketing/assets/81/versions/91/download') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: basePng });
      return;
    }
    let body: unknown = [];
    if (url.pathname === '/api/auth/me') body = owner;
    else if (url.pathname === '/api/meta') body = { departments };
    else if (url.pathname === '/api/marketing/concepts') body = [concept];
    else if (url.pathname === '/api/marketing/assets/81/versions') body = [version];
    else if (url.pathname === '/api/marketing/assets/81/versions/91/annotation-state') body = { schema_version: 1, base_version_id: 91, objects: [] };
    else if (url.pathname === '/api/posts') body = { items: [], next_cursor: null, has_more: false };
    else if (url.searchParams.get('paginated') === 'true') body = { items: [], next_cursor: null, has_more: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('Annotation Studio modern workspace', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
  });

  test('keeps the creative canvas prominent on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/posts/editor?conceptId=51&assetId=81&versionId=91');
    await expect(page.getByRole('heading', { name: 'Annotation studio' })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas?.width || 0).toBeGreaterThan(300);
    expect(canvas?.height || 0).toBeGreaterThan(150);
  });

  test('uses a horizontally scrollable control dock on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/posts/editor?conceptId=51&assetId=81&versionId=91');
    const controls = page.getByLabel('Annotation controls');
    await expect(controls).toBeVisible();
    const overflowX = await controls.evaluate(el => getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');
    await expect(page.getByRole('button', { name: /Select/ })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
