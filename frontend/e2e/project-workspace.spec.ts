import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

function workspace(manager: boolean) {
  return {
    project: { id: 11, title: 'Halloween', status: 'Active', note: 'Garden activities and snacks.', due_date: '2026-10-31T09:00:00Z' },
    can_manage: manager, can_contribute: true, tasks: [],
    comments: [{ id: 52, author_name: 'Bea Lim', author_id: 2, body: 'Pumpkin decorating?', comment_type: 'Suggestion', created_at: '2026-10-17T10:00:00Z', vote_count: 1, voted: false, reply_to_id: null }],
    purchases: [{ id: 7, name: 'Pumpkins', category: 'Activities', proposed_by_name: 'Bea Lim', status: 'Suggested', quantity: 12, unit_price_cents: 18000, estimate_cents: 216000, source_comment_id: 52, can_edit: manager, version: 1 }],
    budget: { limit_cents: 2000000, version: 1, planned_cents: 0, purchased_cents: 0, committed_cents: 0, remaining_cents: 2000000, forecast_cents: 216000, unpriced_count: 0 },
  };
}

async function setup(page: Page, manager: boolean) {
  const user = { id: 1, name: 'Caryl', role: manager ? 'owner' : 'staff', department_id: 1, departments: [{ id: 1, name: 'Marketing' }] };
  const data = workspace(manager);
  let reads = 0;
  await page.addInitScript(value => {
    localStorage.setItem('cc_user', JSON.stringify(value));
    localStorage.setItem('cc_department_id', '1');
  }, user);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === '/api/auth/me') body = user;
    if (path === '/api/meta') body = { departments: user.departments, capabilities: [] };
    if (path === '/api/notifications') body = { items: [], unread_count: 0, next_cursor: null };
    if (path === '/api/project-workspaces/11') { reads++; body = data; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { data, reads: () => reads };
}

for (const width of [1440, 390]) {
  test(`project discussion and purchases are accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, true);
    await page.goto('/projects/11?discussion=52');
    await expect(page.getByRole('textbox', { name: 'Reply', exact: true })).toBeVisible();
    for (const section of ['Discussion', 'Purchase list']) {
      await page.getByRole('tab', { name: section, exact: true }).click();
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(audit.violations.filter(v => ['critical', 'serious'].includes(v.impact || ''))).toEqual([]);
    }
    await page.getByRole('button', { name: 'Suggest item', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('40');
    await page.getByRole('spinbutton', { name: 'Unit estimate (₱)', exact: true }).fill('12.50');
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('₱500.00');
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
  });
}

test('staff receives automatic updates without losing drafts and cannot manage purchases', async ({ page }) => {
  await page.clock.install();
  const state = await setup(page, false);
  await page.goto('/projects/11');
  const draft = page.getByRole('textbox', { name: 'Discussion message', exact: true });
  await draft.fill('Keep this draft');
  state.data.comments.push({ ...state.data.comments[0], id: 53, body: 'New staff idea' });
  await page.clock.fastForward(11_000);
  await expect(page.getByText('New staff idea', { exact: true })).toBeVisible();
  await expect(draft).toHaveValue('Keep this draft');
  expect(state.reads()).toBeGreaterThan(1);
  await page.getByRole('tab', { name: 'Purchase list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Suggest item', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to plan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});
