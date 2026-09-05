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

// Compact deterministic PNG. It is deliberately served as application/octet-stream
// so this audit exercises the filename fallback fixed by PR #81.
const samplePngBase64 = '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';

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
    else if (path === '/api/marketing/campaigns') body = cursorPage([]);
    else if (path === '/api/marketing/concepts') body = cursorPage([]);
    else if (path === '/api/marketing/calendar') body = cursorPage([]);
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
  const createSurface = page.getByRole('region', { name: 'Create marketing content' });
  await expect(createSurface).toBeVisible();
  await expect(createSurface.getByRole('heading', { name: 'Create content item' })).toBeVisible();
  await expect(newContent).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: `test-results/ui-audit/marketing-${name}.png`, fullPage: true });
}

async function captureAnnotation(page: Page, name: string) {
  await page.goto('/posts/editor?postId=101&versionId=501');
  await expect(page.getByRole('heading', { name: 'Annotation studio' })).toBeVisible();
  const versionSelect = page.getByRole('combobox', { name: 'Creative image version' });
  await expect(versionSelect).toHaveValue('501');
  await page.getByRole('button', { name: 'Open version' }).click();
  await expect(page.getByText('september-campaign.png', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save annotated version' })).toBeEnabled();
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
