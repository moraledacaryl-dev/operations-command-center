import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const departments = [
  { id: 1, name: 'Front Office', is_primary: false },
  { id: 2, name: 'Housekeeping', is_primary: false },
  { id: 3, name: 'Marketing', is_primary: true },
];

const owner = {
  id: 1,
  name: 'Owner',
  email: 'owner@example.test',
  role: 'owner',
  primary_department_id: 3,
  departments,
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

const samplePost = {
  id: 101,
  title: 'September campaign creative',
  status: 'Draft',
  platform: 'Instagram',
  content_type: 'Static',
  post_date: '2026-09-12',
  caption: 'Hidden Oasis September campaign',
  campaign: 'September campaign',
  department_id: 3,
  allowed_actions: ['submit-review'],
};

const sampleCampaign = {
  id: 41,
  department_id: 3,
  name: 'September Escape',
  objective: 'Drive direct bookings',
};

const sampleVersion = {
  id: 501,
  post_id: 101,
  version_no: 1,
  filename: 'september-campaign.png',
  file_url: '/api/posts/101/versions/501/download',
  note: 'Original campaign creative',
  created_at: '2026-09-05T08:00:00Z',
  is_current: true,
};

// Compact deterministic 320x180 PNG. It is deliberately served as
// application/octet-stream to exercise the filename fallback fixed by PR #81.
const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAABrUlEQVR42u3VQQ2AMBBEUSDoWBGcq6SaOPVcTXtAESqaJpv3JEzyM2f096Cur08jFHaZAAQMCBgQMAgYEDAgYEDAIGBAwICAQcCAgAEBAwIGAQMCBgQMCBgEDAgYEDAIGBAwIGBAwCBgQMCAgAEBg4ABAQMCBgEDAgYEDAgYBAwIGBAwCBgQMCBgQMAgYEDAgIABAYOAAQEDAgYBAwIGBAwIGAQMCBgQMCBgEDAgYEDAIGBAwICAAQGDgAEBAwIGBAwCBgQMCBgEDAgYEDAgYBAwIGBAwCBgQMCAgAEBg4ABAQMCBgQMAgb2u6OlFQrL8RjBAwMCBgQMCBgEDAgYEDAIGBAwIGBAwCBgQMCAgEHAJgABAwIGBAwCBgQMCBgQMAgYEDAgYBAwIGBAwICAQcCAgAEBAwIGAQMCBgQMAgYEDAgYEDAIGBAwIGBAwCBgQMCAgEHAgIABAQMCBgEDAgYEDAIGBAwIGBAwCBgQMCBgQMAgYEDAgIBBwICAAQEDAgYBAwIGBAwIGAQMCBgQMAgYEDAgYEDAIGBAwICAAQGDgAEBAwIGAQMCBlb6AdYvBvBj1YpoAAAAAElFTkSuQmCC';

function cursorPage(items: unknown[]) {
  return { items, next_cursor: null, has_more: false };
}

async function seedAuthenticatedMarketing(page: Page) {
  await page.addInitScript(({ session, dept }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(dept));
  }, { session: owner, dept: 3 });

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === '/api/posts/101/versions/501/download') {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: Buffer.from(samplePngBase64, 'base64'),
      });
      return;
    }

    let body: unknown = [];
    if (path === '/api/auth/me') body = owner;
    else if (path === '/api/meta') body = { departments };
    else if (path === '/api/posts/101/versions') body = [sampleVersion];
    else if (path === '/api/posts/101') body = { ...samplePost, comments: [] };
    else if (path === '/api/posts') body = cursorPage([samplePost]);
    else if (path === '/api/marketing/campaigns') body = [sampleCampaign];
    else if (path === '/api/marketing/concepts') body = [];
    else if (path === '/api/marketing/calendar') body = [];
    else if (url.searchParams.get('paginated') === 'true') body = cursorPage([]);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function captureMarketing(page: Page, name: string) {
  await page.goto('/posts');
  await expect(page.getByRole('heading', { name: 'Marketing', exact: true })).toBeVisible();
  const newContent = page.getByRole('button', { name: 'New content' });
  await expect(newContent).toBeVisible();
  await newContent.click();
  await expect(page.getByRole('heading', { name: 'Create multi-platform concept' })).toBeVisible();
  const campaignSelect = page.getByRole('combobox', { name: 'Campaign' });
  await expect(campaignSelect).toHaveValue('41');
  await expect(page.getByRole('checkbox', { name: 'Facebook' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Instagram' })).toBeChecked();
  await page.screenshot({ path: `test-results/ui-audit/marketing-${name}.png`, fullPage: true });
}

async function captureAnnotation(page: Page, name: string) {
  await page.goto('/posts/editor?postId=101&versionId=501');
  await expect(page.getByRole('heading', { name: 'Annotation studio' })).toBeVisible();
  const versionSelect = page.getByRole('combobox', { name: 'Creative image version' });
  await expect(versionSelect).toHaveValue('501');
  await page.getByRole('button', { name: 'Open version' }).click();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save annotated version' })).toBeEnabled();
  await expect(page.getByText('Open a creative to start annotating')).toHaveCount(0);
  const canvasRegion = page.getByRole('region', { name: 'Creative annotation canvas' });
  await expect(canvasRegion.locator('canvas').first()).toBeVisible();
  await expect(canvasRegion.locator('canvas').first()).toHaveAttribute('width', '320');
  await expect(canvasRegion.locator('canvas').first()).toHaveAttribute('height', '180');
  await page.screenshot({ path: `test-results/ui-audit/annotation-${name}.png`, fullPage: true });
}

test.beforeAll(() => {
  mkdirSync('test-results/ui-audit', { recursive: true });
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`captures Marketing and Annotation repaired states at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await seedAuthenticatedMarketing(page);
    await captureMarketing(page, viewport.name);
    await captureAnnotation(page, viewport.name);
  });
}
