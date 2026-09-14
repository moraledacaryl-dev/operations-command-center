import { expect, test } from '@playwright/test';

test('visual correction stylesheet is active', async ({ page }) => {
  await page.goto('/login');
  const loaded = await page.evaluate(() => Array.from(document.styleSheets).some(sheet => sheet.href?.includes('ui-visual-correction')));
  expect(loaded).toBeTruthy();
});
