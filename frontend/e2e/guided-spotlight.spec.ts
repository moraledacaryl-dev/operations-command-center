import { expect, test } from '@playwright/test';

const fictional = {
  id: 9101, name: 'Demo Training Supervisor', email: 'practice-guide@training.invalid',
  role: 'manager', is_active: true,
  departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
  primary_department_id: 41,
  capabilities: { manage_department: true, make_decisions: true, view_all_operations: true },
};

async function startDemo(page: import('@playwright/test').Page, withWorkflow = false) {
  await page.addInitScript(({ user, workflow }) => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '41');
    if (workflow) localStorage.setItem('ho-ops-verified-workflow-v1:' + String(user.id), JSON.stringify({
      kind: 'shared-no-owner', ownerId: String(user.id), step: 0,
      createdAt: '2026-10-30T00:00:00.000Z', reference: 'TRN-TASK-TEST1234',
    }));
  }, { user: fictional, workflow: withWorkflow });
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], counts: {}, unread_count: 0 }),
  }));
}

test('first open makes Start obvious, then moves the orange focus after real user input', async ({ page }) => {
  await startDemo(page);
  await page.goto('/training');
  await expect(page.getByTestId('training-start-here')).toBeVisible();
  await expect(page.getByTestId('training-spotlight')).toContainText('Welcome! Start your first lesson');
  await page.getByRole('button', { name: 'Start guided lesson' }).click();
  await expect(page.getByTestId('scenario-case-brief')).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByRole('button', { name: 'Show me the first answer' }).click();
  await expect(page.getByTestId('scenario-priority')).toHaveAttribute('data-training-spotlight-target', 'true');

  await page.getByTestId('scenario-priority').selectOption('Routine');
  await expect(page.getByTestId('scenario-department')).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByTestId('scenario-department').selectOption('Front Desk');
  await expect(page.getByTestId('scenario-check-assessment')).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByTestId('scenario-check-assessment').click();
  await expect(page.getByTestId('scenario-priority')).toHaveAttribute('data-training-spotlight-target', 'true');

  await page.getByTestId('scenario-priority').selectOption('High');
  await page.getByTestId('scenario-check-assessment').click();
  await expect(page.getByTestId('scenario-decision')).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByTestId('scenario-decision').selectOption('Assign and follow up');
  await expect(page.getByTestId('scenario-note')).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByTestId('scenario-note').fill(
    'DEMO-HANDOVER-014 remains unresolved. Assign the Front Desk lead as owner, verify what happened, and update the fictional guest before handover.',
  );
  await expect(page.getByTestId('scenario-submit')).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByTestId('scenario-submit').click();
  await expect(page.getByTestId('scenario-complete')).toBeVisible();
  await expect(page.getByTestId('training-spotlight')).toContainText('You passed this lesson');
  await page.getByRole('button', { name: 'Repeat this lesson' }).click();
  await expect(page.getByTestId('scenario-triage')).toBeVisible();
  await expect(page.locator('.practice-progress strong')).toHaveText(/^1 \/ \d+$/);
  await expect(page.getByTestId('training-spotlight')).toContainText('Step 1: Read');
});

test('dismissal is optional, and any trainee can restart the guided lesson', async ({ page }) => {
  await startDemo(page);
  await page.goto('/training');
  await page.getByRole('button', { name: 'Hide lesson arrows' }).click();
  await expect(page.getByTestId('training-spotlight')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('training-spotlight')).toHaveCount(0);
  await page.getByTestId('show-lesson-arrows').click();
  await expect(page.getByTestId('training-spotlight')).toContainText('Step 1: Read');
  await page.getByTestId('repeat-current-lesson').click();
  await expect(page.getByTestId('scenario-triage')).toBeVisible();
  await expect(page.getByTestId('training-spotlight')).toContainText('Step 1: Read');
});

test('actual Tasks module highlights New, then the real form, and Repeat creates a fresh reference', async ({ page }) => {
  await startDemo(page, true);
  await page.goto('/tasks');
  await expect(page.getByTestId('training-workflow-coach')).toBeVisible();
  await expect(page.getByTestId('training-spotlight')).toContainText('Click New');
  // Guidance must never physically block the underlying application buttons.
  await expect(page.locator('.training-spotlight-popover')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.training-spotlight-dismiss')).toHaveCSS('pointer-events', 'auto');
  await expect(page.getByTestId('create-task')).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByTestId('create-task').click();
  const form = page.getByTestId('create-task-form');
  await expect(form.locator('input').first()).toHaveAttribute('data-training-spotlight-target', 'true');
  const first = await page.getByTestId('training-workflow-reference').innerText();
  await form.locator('input').first().fill('Repair fictional room lighting ' + first);
  await expect(form.locator('select').first()).toHaveAttribute('data-training-spotlight-target', 'true');
  await form.locator('select').first().selectOption('High');
  await expect(form.locator('select').nth(1)).toHaveAttribute('data-training-spotlight-target', 'true');
  await page.getByTestId('repeat-real-workflow').click();
  await expect(page.getByTestId('training-workflow-reference')).not.toHaveText(first);
  await expect(page.getByTestId('training-workflow-coach')).toContainText('Stage 1 of 3');
});
