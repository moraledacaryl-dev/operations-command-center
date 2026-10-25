import { expect, test } from '@playwright/test';

type TrainingRole = 'staff' | 'supervisor' | 'manager';
const capabilitiesFor = (role: TrainingRole) => ({
  manage_department: role !== 'staff',
  make_decisions: role === 'manager',
  manage_accounts: false,
  view_all_operations: role === 'manager',
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
  await expect(library).not.toContainText('Creating and managing a task');
  await library.getByRole('button', { name: /Getting around Operations/ }).click();
  const step = page.getByRole('dialog', { name: /Training step/ });
  await expect(step).toContainText('Where you are');
  await expect(page.locator('.ops-guide-spotlight')).toBeVisible();
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
  await expect(library).not.toContainText('People and access administration');
});

test('mobile staff can open and close the training library', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMockWorkspace(page, 'staff');
  await expect(page.getByRole('dialog', { name: 'Interactive staff training' })).toBeVisible();
  await page.getByRole('button', { name: 'Close training' }).click();
  await expect(page.getByRole('dialog', { name: 'Interactive staff training' })).toHaveCount(0);
});
