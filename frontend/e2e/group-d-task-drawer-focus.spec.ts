import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const owner = {
  id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner',
  primary_department_id: 1,
  departments: [{ id: 1, name: 'Front Office', is_primary: true }],
  capabilities: { manage_department: true, view_all_operations: true, make_decisions: true },
};

async function seed(page: Page) {
  await page.addInitScript(session => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '1');
  }, owner);

  let moved = false;
  let refreshing = false;
  let resumeRefresh: (() => void) | null = null;
  const task = () => ({
    id: 711,
    title: 'Check pool filter',
    department_id: 1,
    status: moved ? 'Doing' : 'To Do',
    priority: 'Normal',
    allowed_actions: moved ? [] : ['start'],
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = [];
    if (path === '/api/auth/me') data = owner;
    else if (path === '/api/meta') data = { departments: owner.departments, users: [] };
    else if (path === '/api/notifications') data = { items: [], unread_count: 0, has_more: false, next_cursor: null };
    else if (path === '/api/tasks/711') data = task();
    else if (path === '/api/workflow/tasks/711/start') {
      expect(route.request().method()).toBe('POST');
      moved = true;
      data = task();
    } else if (path === '/api/tasks' || path === '/api/tasks/page') {
      if (moved) {
        refreshing = true;
        await new Promise<void>(resolve => { resumeRefresh = resolve; });
      }
      data = path.endsWith('/page')
        ? { items: [task()], next_cursor: null, has_more: false } : [task()];
    } else if (url.searchParams.get('paginated') === 'true') {
      data = { items: [], next_cursor: null, has_more: false };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return {
    isRefreshing: () => refreshing,
    finish: () => {
      // Resolve the queued read without modifying source or production data.
      const release = resumeRefresh;
      if (release) release();
    },
  };
}

for (const viewport of [
  { label: 'desktop list', width: 1440, height: 900, board: false },
  { label: 'mobile board', width: 390, height: 844, board: true },
]) {
  test(`task workflow keeps its drawer and keyboard focus during refresh at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const control = await seed(page);
    await page.goto('/tasks');
    await expect(page.getByTestId('tasks-board')).toBeVisible();
    if (!viewport.board) await page.getByRole('button', { name: 'List', exact: true }).click();

    const trigger = page.getByRole('button', { name: /Check pool filter/ });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Check pool filter' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close details' })).toBeFocused();
    await expect(page.locator('#operations-app-root')).toHaveAttribute('inert', '');

    try {
      await dialog.getByRole('button', { name: 'Start work' }).click();
      await expect.poll(control.isRefreshing).toBe(true);
      // The async list refresh is deliberately held pending here.
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Check pool filter' })).toBeVisible();
    } finally {
      control.finish();
    }

    await expect(dialog.getByText('No task transition is available')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close details' })).toBeFocused();
    mkdirSync('test-results/ui-audit', { recursive: true });
    await page.screenshot({
      path: `test-results/ui-audit/group-d-task-drawer-${viewport.board ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#operations-app-root')).not.toHaveAttribute('inert', '');
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
    if (viewport.board) {
      // The board moved the original trigger to another column.
      await expect(page.locator('#workspace-main')).toBeFocused();
    } else {
      await expect(page.getByRole('button', { name: /Check pool filter/ })).toBeFocused();
    }
  });
}
