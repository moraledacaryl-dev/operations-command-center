import { expect, test, type Page } from '@playwright/test';

const marketingDepartment = { id: 9, name: 'Marketing', is_primary: true };
const owner = {
  id: 1,
  name: 'Owner',
  email: 'owner@example.test',
  role: 'owner',
  primary_department_id: 9,
  departments: [marketingDepartment],
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

const post = {
  id: 7,
  title: 'September campaign',
  platform: 'Facebook',
  content_type: 'Static',
  status: 'Draft',
  post_date: '2026-09-12',
  caption: 'Campaign brief',
  department_id: 9,
  allowed_actions: [],
  comments: [],
};

const version = {
  id: 11,
  post_id: 7,
  version_no: 1,
  filename: 'creative.png',
  file_url: '/uploads/posts/creative.png',
  is_current: true,
};

async function seedMarketing(page: Page) {
  await page.addInitScript(({ session, dept }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', String(dept));
  }, { session: owner, dept: 9 });

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith('/api/auth/me')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(owner) });
    if (path.endsWith('/api/meta')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ departments: [marketingDepartment] }) });
    if (path.endsWith('/api/marketing/campaigns') || path.endsWith('/api/marketing/concepts') || path.endsWith('/api/marketing/calendar')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], next_cursor: null, has_more: false }) });
    }
    if (path.endsWith('/api/posts/7/versions/11/download')) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: png });
    }
    if (path.endsWith('/api/posts/7/versions')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([version]) });
    if (path.endsWith('/api/posts/7')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(post) });
    if (path.endsWith('/api/posts') && url.searchParams.get('paginated') === 'true') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [post], next_cursor: null, has_more: false }) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test('New content visibly opens and focuses the creation panel', async ({ page }) => {
  await seedMarketing(page);
  await page.goto('/posts');

  const button = page.getByRole('button', { name: 'New content' });
  await expect(button).toBeVisible();
  await button.click();

  await expect(page.getByRole('heading', { name: 'Create content item' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close form' })).toBeVisible();
  await expect(page.getByLabel('Title')).toBeFocused();
});

test('Annotation studio auto-loads selected stored image even with generic MIME type', async ({ page }) => {
  await seedMarketing(page);
  await page.goto('/posts/editor?postId=7&versionId=11');

  await expect(page.getByLabel('Creative image version')).toHaveValue('11');
  await expect(page.locator('canvas').first()).toHaveAttribute('width', '1');
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
});
