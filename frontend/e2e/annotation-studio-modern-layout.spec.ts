import { expect, test } from '@playwright/test';
import { installApiMock, loginAs } from './support/api-mock';

test.describe('Annotation Studio modern workspace', () => {
  test.beforeEach(async ({ page }) => {
    await installApiMock(page);
    await loginAs(page, 'owner');
  });

  test('keeps the creative canvas prominent on desktop', async ({ page }) => {
    await page.goto('/posts/editor?postId=1&versionId=1');
    await expect(page.getByRole('heading', { name: 'Annotation studio' })).toBeVisible();
    const workspace = page.locator('main').locator('div').filter({ has: page.locator('canvas') }).last();
    await expect(page.locator('canvas').first()).toBeVisible();
    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas?.width || 0).toBeGreaterThan(300);
    expect(canvas?.height || 0).toBeGreaterThan(150);
  });

  test('uses a horizontally scrollable control dock on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/posts/editor?postId=1&versionId=1');
    const controls = page.getByLabel('Annotation controls');
    await expect(controls).toBeVisible();
    const overflowX = await controls.evaluate(el => getComputedStyle(el).overflowX);
    expect(overflowX).toBe('auto');
    await expect(page.getByRole('button', { name: /Select/ })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
