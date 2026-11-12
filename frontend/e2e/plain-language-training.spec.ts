import { expect, test } from '@playwright/test';
import { PRACTICE_SCENARIOS } from '../lib/practice-scenarios';
import { plainWordsForScenario } from '../lib/training-plain-language';

test('first situation explains exactly what the guest reported and what staff failed to do', () => {
  const first = PRACTICE_SCENARIOS.find(item => item.id === 'shift-unresolved');
  expect(first).toBeDefined();
  expect(first!.situation).toContain('toilet will not flush');
  expect(first!.situation).toContain('30 minutes ago');
  expect(first!.situation).toContain('call the guest back');
  expect(first!.context.join(' ')).not.toMatch(/has not yet received a status update|documented follow-up owner/i);
  const terms = plainWordsForScenario(first!);
  expect(terms.map(item => item.term)).toEqual([
    'Reference number', 'Urgency / priority', 'Shift handover',
    'Person responsible (owner)', 'Guest update',
  ]);
  for (const item of terms) {
    expect(item.meaning.length).toBeGreaterThan(45);
    expect(item.meaning).not.toMatch(/accountability|escalation|handover protocol|triage/i);
  }
});

test('each practice lesson offers immediate simple definitions without changing its graded answers', () => {
  expect(PRACTICE_SCENARIOS).toHaveLength(122);
  for (const item of PRACTICE_SCENARIOS) {
    const words = plainWordsForScenario(item);
    expect(words.length, item.id).toBeGreaterThanOrEqual(2);
    expect(words.length, item.id).toBeLessThanOrEqual(5);
    expect(new Set(words.map(w => w.term)).size).toBe(words.length);
    expect(['Routine', 'High', 'Critical']).toContain(item.priority);
  }
});

test('a new staff trainee sees a concrete situation and its vocabulary before choosing urgency', async ({ page }) => {
  const trainee = {
    id: 7139, role: 'staff', name: 'Fictional Practice Trainee',
    email: 'plain-language@training.invalid', is_active: true,
    departments: [{ id: 41, name: 'Front Desk', is_primary: true }],
    primary_department_id: 41,
    capabilities: { manage_department: false, make_decisions: false },
  };
  await page.addInitScript(user => {
    localStorage.setItem('cc_user', JSON.stringify(user));
    localStorage.setItem('cc_department_id', '41');
  }, trainee);
  await page.route('**/api/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ counts: {}, items: [], unread_count: 0 }),
  }));
  await page.goto('/training');
  await expect(page.getByTestId('scenario-training')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Practice common work situations' })).toBeVisible();
  await expect(page.getByTestId('scenario-training')).toContainText('FOR PRACTICE ONLY.');
  await expect(page.locator('.practice-progress-more')).not.toHaveAttribute('open');
  await expect(page.getByRole('button', { name: 'Save my results (CSV)' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check my choices' })).toBeVisible();

  await expect(page.getByTestId('scenario-three-stage')).toContainText('Show me an example');
  await expect(page.getByTestId('scenario-three-stage')).toContainText('Try it with help');
  await expect(page.getByTestId('scenario-three-stage')).toContainText('Your turn');
  await expect(page.getByTestId('scenario-triage')).toContainText('Your turn — Step 1');
  await expect(page.getByTestId('scenario-case-brief')).toContainText('guest has waited 30 minutes');
  await expect(page.getByTestId('training-simple-words')).toBeVisible();
  await expect(page.getByTestId('training-simple-words')).toContainText('Reception calls or speaks to the guest');
  await expect(page.getByTestId('training-simple-words')).toContainText('When one employee finishes work');
  await expect(page.getByTestId('judgment-consequence')).toContainText('What could go wrong if nobody helps?');
  await expect(page.getByTestId('judgment-timing')).toContainText('How soon should someone do something?');
  await expect(page.getByTestId('scenario-triage')).not.toContainText('The guest has not yet received a status update');
  await expect(page.getByTestId('scenario-priority')).toHaveValue('');
  await expect(page.getByTestId('open-real-screens')).toHaveAttribute('href', '/');
});
