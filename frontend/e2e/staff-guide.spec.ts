import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 77, name: 'Demo Bar employee', role: 'staff',
  departments: [{ id: 12, name: 'Bar', is_primary: true }],
  capabilities: { manage_department: false, view_all_operations: false },
};

async function mockGuide(page: Page) {
  await page.addInitScript(person => {
    localStorage.setItem('cc_user', JSON.stringify(person));
    localStorage.setItem('ho-ops-structured-course-v2:' + person.id, JSON.stringify({
      lessonId: 'orientation', stage: 'finished', question: 0,
      passed: 'orientation staff-handover staff-rooms staff-my-work team-tasks guest-matters maintenance requests shift-writing projects marketing management-review accounts'.split(' '),
    }));
  }, user);
  let acknowledged = false;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === '/api/auth/me') body = user;
    else if (path === '/api/meta') body = { departments: user.departments, users: [user] };
    else if (path === '/api/notifications') body = { items: [], unread_count: 0, next_cursor: null, has_more: false };
    else if (path === '/api/staff-guide' && route.request().method() === 'GET') {
      body = [{ id: 1, title: 'Handling a drink complaint', summary: 'Listen and tell your lead.',
        doc_type: 'SOP', category: 'Guest Service', version: 1,
        requires_ack: true, published_at: '2026-11-10T12:00:00Z' }];
    } else if (path === '/api/staff-guide/mine') {
      body = [{ document_id: 1, revision_id: 9, title: 'Handling a drink complaint',
        acknowledged, due_at: '2026-11-18T12:00:00Z' }];
    } else if (path === '/api/staff-guide/1' && route.request().method() === 'GET') {
      body = { id: 1, status: 'Published', version: 1,
        published: { id: 9, title: 'Handling a drink complaint',
          summary: 'Listen and tell your lead.', body: '1. Listen carefully.\n2. Call your shift lead.',
          category: 'Guest Service', doc_type: 'SOP', version: 1,
          published_at: '2026-11-10T12:00:00Z', requires_ack: true, acknowledged,
          attachments: [] } };
    } else if (path === '/api/staff-guide/1/acknowledge') {
      acknowledged = true;
      body = { acknowledged: true, revision_id: 9 };
    }
    await route.fulfill({ status: 200, json: body });
  });
}

test('Bar employee finds and confirms a relevant policy on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGuide(page);
  await page.goto('/staff-guide');
  await expect(page.getByRole('heading', { name: 'Staff Guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Handling a drink complaint/ })).toBeVisible();
  await page.getByRole('button', { name: /Handling a drink complaint/ }).click();
  await expect(page.getByText('Call your shift lead.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'I have read and understood' })).toBeVisible();
  await page.getByRole('button', { name: 'I have read and understood' }).click();
  await expect(page.getByText('confirmed this version')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('Staff Guide remains staff-readable without management publishing controls', async ({ page }) => {
  await mockGuide(page);
  await page.goto('/staff-guide');
  await expect(page.getByRole('button', { name: 'New guide' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage Guides' })).toHaveCount(0);
  await page.getByRole('button', { name: /My Reading/ }).click();
  await expect(page.getByRole('button', { name: /Handling a drink complaint/ })).toBeVisible();
});
