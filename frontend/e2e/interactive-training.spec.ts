import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('test-results/ui-audit', { recursive: true });

type TrainingRole = 'staff' | 'supervisor' | 'manager' | 'admin';
const capabilitiesFor = (role: TrainingRole) => ({
  manage_department: role !== 'staff',
  make_decisions: role === 'manager' || role === 'admin',
  manage_accounts: role === 'admin',
  view_all_operations: role === 'manager' || role === 'admin',
});

async function openMockWorkspace(page: import('@playwright/test').Page, role: TrainingRole) {
  const user = {
    id: role === 'staff' ? 4101 : role === 'supervisor' ? 4102 : 4103,
    name: 'Fictional Training User',
    email: `${role}@training.invalid`,
    role,
    is_active: true,
    departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
    primary_department_id: 41,
    capabilities: capabilitiesFor(role),
  };
  await page.addInitScript(storedUser => {
    localStorage.setItem('cc_user', JSON.stringify(storedUser));
    localStorage.setItem('cc_department_id', '41');
  }, user);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ counts: {}, groups: {}, unread_count: 0, items: [], results: [], data: [] }),
  }));
  await page.goto('/');
  await expect(page.getByTestId('interactive-training-open')).toBeVisible();
  await page.getByTestId('interactive-training-open').click();
}

test('no walkthrough launcher on the login screen', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('interactive-training-open')).toHaveCount(0);
});

test('staff have read-only lessons with guided spotlights', async ({ page }) => {
  await openMockWorkspace(page, 'staff');
  const library = page.getByRole('dialog', { name: 'Interactive staff training' });
  await expect(library).toContainText('Getting around Operations');
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-staff-library.png' });
  await expect(library).not.toContainText('Creating and managing a task');
  await library.getByRole('button', { name: /Getting around Operations/ }).click();
  const step = page.getByRole('dialog', { name: /Training step/ });
  await expect(step).toContainText('Where you are');
  await expect(page.locator('.ops-guide-spotlight')).toBeVisible();
  await expect(page.locator('.ops-guide-arrow')).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-staff-spotlight.png' });
  await step.getByRole('button', { name: /Next/ }).click();
  await expect(step).toContainText('My Work');
  await step.getByRole('button', { name: /Exit/ }).click();
  await expect(step).toHaveCount(0);
});

test('supervisor sees work training but not management decisions', async ({ page }) => {
  await openMockWorkspace(page, 'supervisor');
  const library = page.getByRole('dialog', { name: 'Interactive staff training' });
  await expect(library).toContainText('Creating and managing a task');
  await expect(library).not.toContainText('Review and approval decisions');
});

test('manager sees authorization-appropriate review lessons', async ({ page }) => {
  await openMockWorkspace(page, 'manager');
  const library = page.getByRole('dialog', { name: 'Interactive staff training' });
  await expect(library).toContainText('Review and approval decisions');
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-manager-library.png' });
  await expect(library).not.toContainText('People and access administration');
});

test('mobile staff can open and close the training library', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMockWorkspace(page, 'staff');
  await expect(page.getByRole('dialog', { name: 'Interactive staff training' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-mobile-library.png' });
  await page.getByRole('button', { name: 'Close training' }).click();
  await expect(page.getByRole('dialog', { name: 'Interactive staff training' })).toHaveCount(0);
});

test('supervisor safely opens a task form and cancels without writing', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
  });
  await openMockWorkspace(page, 'supervisor');
  const library = page.getByRole('dialog', { name: 'Interactive staff training' });
  await library.getByRole('button', { name: /Creating and managing a task/ }).click();
  const step = page.getByRole('dialog', { name: /Training step/ });
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(step).toContainText('Board versus List');
  await step.getByRole('button', { name: /Next/ }).click();
  await expect(step).toContainText('Search before creating');
  await step.getByRole('button', { name: /Next/ }).click();
  await expect(step).toContainText('Open New task');
  await page.getByTestId('create-task').click();
  await expect(step).toContainText('Fill out the task');
  await expect(page.getByTestId('create-task-form')).toBeVisible();
  await expect(page.locator('.ops-guide-spotlight')).toBeVisible();
  await expect.poll(async () => {
    const focus = await page.locator('.ops-guide-spotlight').boundingBox();
    const popup = await page.locator('.ops-guide-tip').boundingBox();
    if (!focus || !popup) return 1;
    const width = Math.max(0, Math.min(focus.x + focus.width, popup.x + popup.width) - Math.max(focus.x, popup.x));
    const height = Math.max(0, Math.min(focus.y + focus.height, popup.y + popup.height) - Math.max(focus.y, popup.y));
    return (width * height) / Math.max(1, focus.width * focus.height);
  }).toBeLessThan(0.02);
  await page.screenshot({ path: 'test-results/ui-audit/interactive-training-task-form.png' });
  await step.getByRole('button', { name: /Next/ }).click();
  await expect(step).toContainText('Close without saving');
  await page.getByTestId('create-task-form').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Interactive staff training' })).toContainText('Tour viewed');
  await expect(page.getByTestId('create-task-form')).toHaveCount(0);
  expect(writes.filter(w => /\/api\/(tasks|workflow|requests)/.test(w))).toEqual([]);
});

test('supervisor request walkthrough opens and cancels an unsaved proposal', async ({ page }) => {
  await openMockWorkspace(page, 'supervisor');
  await page.getByRole('dialog', { name: 'Interactive staff training' })
    .getByRole('button', { name: /Operational request approval/ }).click();
  const step = page.getByRole('dialog', { name: /Training step/ });
  await expect(page).toHaveURL(/\/requests$/);
  await step.getByRole('button', { name: /Next/ }).click();
  await expect(step).toContainText('Open New request');
  await page.getByTestId('create-request').click();
  await expect(step).toContainText('Write the reason');
  await expect(page.getByTestId('create-request-form')).toBeVisible();
  await step.getByRole('button', { name: /Next/ }).click();
  await expect(step).toContainText('Close the sample request');
  await page.getByTestId('create-request-form').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('create-request-form')).toHaveCount(0);
});

test('administrator sees people and access lessons', async ({ page }) => {
  await openMockWorkspace(page, 'admin');
  await expect(page.getByRole('dialog', { name: 'Interactive staff training' })).toContainText('People and access administration');
});
