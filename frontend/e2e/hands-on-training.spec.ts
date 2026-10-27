import { expect, test } from '@playwright/test';

type FictionalRole = 'staff' | 'manager';

async function signInToFictionalWorkspace(page: import('@playwright/test').Page, role: FictionalRole) {
  const user = {
    id: role === 'staff' ? 7101 : 7102,
    name: role === 'staff' ? 'Fictional Reception Trainee' : 'Fictional Training Manager',
    email: role + '@training.invalid',
    role,
    is_active: true,
    departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
    primary_department_id: 41,
    capabilities: {
      manage_department: role === 'manager',
      make_decisions: role === 'manager',
      view_all_operations: role === 'manager',
    },
  };
  await page.addInitScript(storedUser => {
    localStorage.setItem('cc_user', JSON.stringify(storedUser));
    localStorage.setItem('cc_department_id', '41');
  }, user);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ counts: {}, items: [], unread_count: 0 }),
  }));
  await page.goto('/training');
  await expect(page.getByTestId('scenario-training')).toBeVisible();
}

test('first open goes to role login without a cached fictional account', async ({ page }) => {
  await page.goto('/training');
  await expect(page).toHaveURL(/\/login\?next=%2Ftraining|\/login\?next=\/training/);
  await expect(page.getByRole('heading', { name: 'Sign in to Operations' })).toBeVisible();
});

test('reception must click choices, type a case note and correct mistakes before progress is recorded', async ({ page }) => {
  await signInToFictionalWorkspace(page, 'staff');
  await expect(page.getByRole('heading', { name: 'Practice real decisions in a safe simulation' })).toBeVisible();
  await expect(page.getByTestId('scenario-guest-ac')).toBeVisible();
  await expect(page.getByTestId('scenario-manager-evidence')).toHaveCount(0);

  await page.getByTestId('scenario-priority').selectOption('Routine');
  await page.getByTestId('scenario-department').selectOption('Front Desk');
  await page.getByRole('button', { name: 'Check my assessment' }).click();
  await expect(page.getByText('Not quite. Re-read the situation')).toBeVisible();
  await expect(page.getByTestId('scenario-document')).toHaveCount(0);

  await page.getByTestId('scenario-priority').selectOption('High');
  await page.getByRole('button', { name: 'Check my assessment' }).click();
  await expect(page.getByTestId('scenario-document')).toBeVisible();

  await page.getByTestId('scenario-decision').selectOption('Document and monitor');
  await page.getByTestId('scenario-note').fill('The next shift will follow up on this item, but nobody has been assigned a reference.');
  await page.getByRole('button', { name: 'Submit practice response' }).click();
  await expect(page.getByTestId('scenario-complete')).toHaveCount(0);
  await expect(page.getByText('Your response needs changes')).toBeVisible();

  await page.getByTestId('scenario-decision').selectOption('Assign and follow up');
  await page.getByTestId('scenario-note').fill(
    'DEMO-HANDOVER-014: Front Desk must contact the fictional guest, take ownership and update the next shift on status.',
  );
  await page.getByRole('button', { name: 'Submit practice response' }).click();
  await expect(page.getByTestId('scenario-complete')).toContainText('Scenario completed');
  await expect(page.getByText('1 / 3')).toBeVisible();

  await page.reload();
  await expect(page.getByText('1 / 3')).toBeVisible();
  await expect(page.getByTestId('scenario-shift-unresolved')).toContainText('Completed');
  await page.getByRole('button', { name: 'Next situation' }).click().catch(() => undefined);
  await page.getByTestId('scenario-guest-ac').click();
  await expect(page.getByTestId('scenario-triage')).toBeVisible();
});

test('manager has management decision scenarios while staff cannot see them', async ({ page }) => {
  await signInToFictionalWorkspace(page, 'manager');
  await expect(page.getByTestId('scenario-manager-evidence')).toBeVisible();
  await expect(page.getByTestId('scenario-manager-guest-recovery')).toBeVisible();
  await expect(page.getByTestId('scenario-kitchen-allergy')).toBeVisible();
  await page.getByTestId('scenario-manager-evidence').click();
  await expect(page.getByRole('heading', { name: 'Approval request without supporting evidence' })).toBeVisible();
  await expect(page.getByText('DEMO-REQ-088').first()).toBeVisible();
});
