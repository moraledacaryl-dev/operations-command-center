import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const owner = { id: 1, name: 'Owner', role: 'owner', primary_department_id: 3, departments: [{ id: 3, name: 'Marketing', is_primary: true }], capabilities: { view_all_operations: true, manage_department: true, make_decisions: true, manage_accounts: true, manage_system: true } };
const post = { id: 41, title: 'Historical creative', department_id: 3, status: 'Draft', content_type: 'Static', allowed_actions: [] };
const missing = { id: 51, post_id: 41, version_no: 1, filename: 'historical.png', file_url: null, file_status: 'unavailable', note: 'Original version history' };

async function seed(page: Page) {
  await page.addInitScript(user => { localStorage.setItem('cc_user', JSON.stringify(user)); localStorage.setItem('cc_department_id', '3'); }, owner);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === '/api/auth/me') body = owner;
    else if (path === '/api/meta') body = { departments: owner.departments };
    else if (path === '/api/posts') body = { items: [post], next_cursor: null, has_more: false };
    else if (path === '/api/posts/41') body = { ...post, comments: [] };
    else if (path === '/api/posts/41/versions') body = [missing];
    await route.fulfill({ json: body });
  });
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`unavailable historical creative preserves history at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await seed(page);
    await page.goto('/posts');
    await page.getByRole('button', { name: /Historical creative/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('historical.png', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Original version history')).toBeVisible();
    await expect(drawer.getByText('File unavailable. Version history is preserved.')).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Open asset', exact: true })).toHaveCount(0);
    await expect(drawer.getByRole('link', { name: 'Annotate', exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    await drawer.getByText('File unavailable. Version history is preserved.').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`historical-media-owner-${width}.png`) });
  });
}

test('direct annotation link does not request an unavailable historical file', async ({ page }) => {
  await seed(page);
  let downloads = 0;
  page.on('request', request => { if (request.url().endsWith('/versions/51/download')) downloads++; });
  await page.goto('/posts/editor?postId=41&versionId=51');
  await expect(page.getByRole('heading', { name: 'Annotation studio' })).toBeVisible();
  await expect(page.getByText('Some historical files are unavailable. Their version history is preserved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open version', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Creative image version' })).toBeDisabled();
  expect(downloads).toBe(0);
});
