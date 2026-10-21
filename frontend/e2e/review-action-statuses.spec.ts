import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const department = { id: 1, name: 'Operations', is_primary: true };
const manager = {
  id: 1,
  name: 'Manager',
  role: 'manager',
  token: 'manager-session',
  primary_department_id: 1,
  departments: [department],
  capabilities: {
    view_all_operations: true,
    manage_department: true,
    make_decisions: true,
    manage_approvals: true,
  },
};
const staff = {
  ...manager,
  id: 2,
  name: 'Staff',
  role: 'staff',
  capabilities: {
    view_all_operations: false,
    manage_department: false,
    make_decisions: false,
    manage_approvals: false,
  },
};

type Item = { id: number; title: string; status?: string; review_status?: string; department_id: number };
type QueueKind = 'submissions' | 'posts' | 'external';

async function setup(page: Page, user: typeof manager, kind: QueueKind, item: Item) {
  await page.addInitScript(({ person }) => {
    localStorage.setItem('cc_user', JSON.stringify(person));
    localStorage.setItem('cc_department_id', '1');
  }, { person: user });

  let action = '';
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/review/queue') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          submissions: kind === 'submissions' ? [item] : [],
          posts: kind === 'posts' ? [item] : [],
          external: kind === 'external' ? [item] : [],
          approvals: [],
          fixes: [],
        }),
      });
      return;
    }
    if (url.pathname === `/api/${kind === 'external' ? 'external-review-items' : kind}/${item.id}`) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(item) });
      return;
    }
    if (route.request().method() === 'POST') {
      action = `${url.pathname}:${JSON.stringify(route.request().postDataJSON())}`;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(item) });
      return;
    }
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"unexpected request"}' });
  });
  return () => action;
}

test.beforeAll(() => mkdirSync('test-results/ui-audit', { recursive: true }));

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`Review-state inbox remains actionable at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const item = { id: 31, title: 'Submission under review', review_status: 'Review', department_id: 1 };
    const called = await setup(page, manager, 'submissions', item);
    await page.goto('/review');
    await page.getByRole('button', { name: /Submission under review/ }).click();
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
    await page.screenshot({ path: `test-results/ui-audit/review-submission-${viewport.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(called).toContain('/api/workflow/submissions/31/decide:{"status":"Accepted"}');
  });

  test(`creative requiring corrections offers only resubmission at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const item = { id: 44, title: 'Creative needing revisions', status: 'Fix', department_id: 1 };
    const called = await setup(page, manager, 'posts', item);
    await page.goto('/review');
    await page.getByRole('button', { name: /Creative needing revisions/ }).click();
    await expect(page.getByRole('button', { name: 'Resubmit for review' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve creative' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Needs fix' })).toHaveCount(0);
    await page.screenshot({ path: `test-results/ui-audit/review-creative-fix-${viewport.name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Resubmit for review' }).click();
    await expect.poll(called).toContain('/api/workflow/posts/44/resubmit-review:');
  });
}

test('non-review staff never see Mark Seen or other decision actions on imported items', async ({ page }) => {
  const item = { id: 56, title: 'Imported operational event', status: 'For Review', department_id: 1 };
  const called = await setup(page, staff, 'external', item);
  await page.goto('/review');
  await page.getByRole('button', { name: /Imported operational event/ }).click();
  await expect(page.getByRole('button', { name: 'Seen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create task' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create approval' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await expect(page.getByText('No further action is available for this item.')).toBeVisible();
  expect(called()).toBe('');
});

test('creative Draft is not falsely offered a decision action', async ({ page }) => {
  const item = { id: 62, title: 'Creative still being drafted', status: 'Draft', department_id: 1 };
  await setup(page, manager, 'posts', item);
  await page.goto('/review');
  // Directly seed a Draft in the mocked queue to check defensive UI handling.
  await page.getByRole('button', { name: /Creative still being drafted/ }).click();
  await expect(page.getByRole('button', { name: 'Approve creative' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Needs fix' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resubmit for review' })).toHaveCount(0);
});
