import { expect, test } from '@playwright/test';

/**
 * Regression for a Mac desktop screenshot: at the centered login breakpoint,
 * the long TRAINING ONLY banner forced the grid column wider than the card.
 */
for (const width of [390, 764, 900]) {
  test(`training login form and controls remain inside panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/login');
    const panel = page.locator('.auth-form-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/TRAINING ONLY/)).toBeVisible();

    const container = await panel.boundingBox();
    expect(container).not.toBeNull();
    const left = container!.x + 1;
    const right = container!.x + container!.width - 1;

    for (const locator of [
      page.locator('#login-email'),
      page.locator('#login-password'),
      panel.getByRole('button', { name: 'Sign in' }),
      panel.getByText(/TRAINING ONLY/),
    ]) {
      const box = await locator.boundingBox();
      expect(box, 'visible login control has a layout box').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(left);
      expect(box!.x + box!.width).toBeLessThanOrEqual(right);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  });
}
