import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const owner = {
  id: 1, name: 'Owner', role: 'owner', primary_department_id: 1,
  departments: [{ id: 1, name: 'Operations', is_primary: true }],
  capabilities: { view_all_operations: true, manage_department: true, make_decisions: true },
};

async function setup(page: Page, holdMutation = false) {
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '1');
  }, owner);
  let moved = false;
  let refreshing = false;
  let mutationStarted = false;
  let released = false;
  const waiting: (() => void)[] = [];
  const project = () => ({ id: 711, title: 'Pool deck restoration', department_id: 1,
    priority: 'Normal', status: moved ? 'Active' : 'Planned', allowed_actions: moved ? ['pause'] : ['start'] });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = [];
    if (path === '/api/auth/me') data = owner;
    else if (path === '/api/meta') data = { departments: owner.departments, users: [] };
    else if (path === '/api/notifications') data = { items: [], unread_count: 0, has_more: false };
    else if (path === '/api/projects/711') data = project();
    else if (path === '/api/workflow/projects/711/start') {
      mutationStarted = true;
      if (holdMutation) await new Promise<void>(resolve => waiting.push(resolve));
      moved = true;
      data = project();
    } else if (path === '/api/projects' || path === '/api/tasks') {
      if (moved && !holdMutation && !released) {
        refreshing = true;
        await new Promise<void>(resolve => waiting.push(resolve));
      }
      data = path === '/api/projects' ? [project()] : [];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return { isRefreshing: () => refreshing, mutationStarted: () => mutationStarted,
    release: () => { released = true; for (const resume of waiting.splice(0)) resume(); } };
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`project drawer stays mounted during workflow refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const control = await setup(page);
    await page.goto('/projects?project=711');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Pool deck restoration' })).toBeVisible();
    mkdirSync('test-results/ui-audit', { recursive: true });
    await page.screenshot({ path: `test-results/ui-audit/project-drawer-before-${width}.png`, fullPage: true });
    try {
      await dialog.getByRole('button', { name: 'Start project', exact: true }).click();
      await expect.poll(control.isRefreshing).toBe(true);
      await page.screenshot({ path: `test-results/ui-audit/project-drawer-pending-${width}.png`, fullPage: true });
      await expect(dialog).toBeVisible();
    } finally { control.release(); }
    // Pause still requires a reason; a different enabled action confirms the
    // held refresh finished and the shared mutation lock was released.
    await expect(dialog.getByRole('button', { name: 'Create linked task', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close details' })).toBeFocused();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/ui-audit/project-drawer-after-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#operations-app-root')).not.toHaveAttribute('inert', '');
  });
}

test('closing a project during a pending mutation does not reopen it', async ({ page }) => {
  const control = await setup(page, true);
  await page.goto('/projects?project=711');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect.poll(control.mutationStarted).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  control.release();
  await expect(page.getByRole('link', { name: /Pool deck restoration/ })).toContainText('Active');
  await expect(dialog).toHaveCount(0);
});
