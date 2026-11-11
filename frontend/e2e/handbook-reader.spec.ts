import { expect, test, type Page } from '@playwright/test';

const owner = {
  id: 92, name: 'Demo owner', role: 'owner',
  departments: [], capabilities: { manage_department: true, view_all_operations: true },
};
const employee = {
  id: 93, name: 'Demo staff', role: 'staff',
  departments: [{ id: 1, name: 'Bar' }],
  capabilities: { manage_department: false, view_all_operations: false },
};
const data = {
  schema: 'hidden-oasis-handbook/v1', title: 'Example Handbook', edition: '2026',
  source_pages: 3,
  chapters: [
    { id: 'section-1', number: '1', title: 'Attendance and Timekeeping', page: 1,
      sections: [
        { id: 'section-1-1', number: '1.1', title: 'Arriving for work', page: 1,
          blocks: [{ type: 'paragraph', text: 'Demo staff arrive for scheduled shifts.' }] },
        { id: 'section-1-2', number: '1.2', title: 'Late arrival', page: 2,
          blocks: [{ type: 'paragraph', text: 'Inform your shift lead about lateness.' },
            { type: 'bullets', items: [{ text: 'Report before the shift.' }] }] },
      ] },
    { id: 'section-2', number: '2', title: 'Guest Service', page: 3,
      sections: [{ id: 'section-2-1', number: '2.1', title: 'Handling questions', page: 3,
        blocks: [{ type: 'paragraph', text: 'Explain the request to a manager.' }] }] },
  ],
};
const published = {
  id: 7, status: 'Published', version: 1,
  published: { id: 40, version: 1, title: 'Example Handbook', doc_type: 'Handbook',
    category: 'Staff Handbook', body: JSON.stringify(data),
    summary: 'Demo handbook', published_at: '2026-11-11T00:00:00Z',
    acknowledged: false, requires_ack: true, attachments: [] },
};
async function setup(page: Page, person = employee) {
  await page.addInitScript(record => {
    localStorage.setItem('cc_user', JSON.stringify(record));
    localStorage.setItem('ho-ops-structured-course-v2:' + record.id, JSON.stringify({
      lessonId: 'orientation', stage: 'finished', question: 0,
      passed: 'orientation staff-handover staff-rooms staff-my-work team-tasks guest-matters maintenance requests shift-writing projects bar marketing management-review accounts'.split(' '),
    }));
  }, person);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = {};
    if (path === '/api/auth/me') result = person;
    else if (path === '/api/meta') result = { users: [person], departments: person.departments };
    else if (path === '/api/notifications') result = { items: [], unread_count: 0, next_cursor: null, has_more: false };
    else if (path === '/api/staff-guide' && route.request().method() === 'GET') result =
      [{ id: 7, title: 'Example Handbook', summary: 'Demo handbook',
        doc_type: 'Handbook', category: 'Staff Handbook', version: 1,
        published_at: '2026-11-11T00:00:00Z', requires_ack: true }];
    else if (path === '/api/staff-guide/mine') result = [];
    else if (path === '/api/staff-guide/manage') result =
      [{ id: 7, title: 'Example Handbook', status: 'Published',
        doc_type: 'Handbook', version: 1, audience: 'all' }];
    else if (path === '/api/staff-guide/7') result = published;
    else if (path === '/api/departments') result = [];
    else if (path === '/api/staff-guide/import-handbook') result =
      { id: 7, title: 'Example Handbook', status: 'Draft', chapters: 2 };
    await route.fulfill({ status: 200, json: result });
  });
}

test('phone handbook scrolls continuously and searches content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/staff-guide?doc=7');
  await expect(page.getByRole('heading', { name: 'Example Handbook' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /1.2 Late arrival/ })).toBeVisible();
  await page.getByRole('button', { name: /Contents · Jump to a section/ }).click();
  await expect(page.getByRole('navigation', { name: 'Handbook table of contents' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Handbook table of contents' })
    .getByRole('button', { name: /1.2 Late arrival/ }).click();
  await expect(page).toHaveURL(/#published-section-1-2$/);
  await page.getByRole('searchbox', { name: 'Search inside this handbook' }).fill('lateness');
  await expect(page.getByText('1 topic found')).toBeVisible();
  await expect(page.locator('mark').first()).toContainText('lateness');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('only owner sees private PDF import action', async ({ page }) => {
  await setup(page);
  await page.goto('/staff-guide');
  await expect(page.getByLabel('Choose handbook PDF (up to 10 MB)')).toHaveCount(0);
});

test('owner may prepare a PDF draft from management screen', async ({ page }) => {
  await setup(page, owner);
  await page.goto('/staff-guide');
  await page.getByRole('button', { name: 'Manage Guides' }).click();
  await expect(page.getByText('Import the staff handbook')).toBeVisible();
  await page.getByLabel('Choose handbook PDF (up to 10 MB)').setInputFiles({
    name: 'staff-handbook.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nsynthetic UI fixture'),
  });
  await expect(page.getByText(/Handbook prepared as a private draft/)).toBeVisible();
});
