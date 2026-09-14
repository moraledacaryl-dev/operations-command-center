import { expect, test } from '@playwright/test';

const representativeRoutes = ['/requests', '/projects', '/tasks'];

for (const route of representativeRoutes) {
  test(`${route} keeps corrected operational composition`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.topbar')).toHaveCSS('border-radius', '26px');
  });
}

test('requests uses a wider sparse-record composition', async ({ page }) => {
  await page.goto('/requests');
  const grid = page.locator('.tabs-shell + .grid.cols-3');
  await expect(grid).toBeVisible();
  await expect(grid).toHaveCSS('grid-template-columns', /.+ .+/);
});

test('tasks board remains visible after composition correction', async ({ page }) => {
  await page.goto('/tasks');
  const board = page.getByTestId('tasks-board');
  await expect(board).toBeVisible();
  await expect(board.locator(':scope > .panel')).toHaveCount(4);
});
