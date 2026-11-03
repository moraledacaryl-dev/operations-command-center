import { test, expect } from '@playwright/test';

const eventData = {
  events: [{
    project_id: 99, event_no: 'EVT-2026-00551', venue: 'Garden', event_date: '2026-12-19',
    tasks: [
      { id: 601, title: 'Before event: Prepare Garden', status: 'To Do', phase: 'Before event', due_date: '2026-12-17T00:00:00+00:00', assigned: false },
      { id: 602, title: 'Before event: Inspect Garden setup', status: 'Review', phase: 'Before event', due_date: '2026-12-18T00:00:00+00:00', assigned: true },
      { id: 603, title: 'After event: Clean and reset Garden', status: 'Done', phase: 'After event', due_date: '2026-12-20T00:00:00+00:00', assigned: true },
      { id: 604, title: 'After event: Inspect Garden for reuse', status: 'To Do', phase: 'After event', due_date: '2026-12-20T00:00:00+00:00', assigned: false },
    ],
  }],
};

test('event venue work is separate, scoped and legible on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('cc_user', JSON.stringify({
      id: 55, name: 'Fictional cleaner', role: 'staff',
      department_id: 42, departments: [{ id: 42, name: 'Housekeeping', is_primary: true }],
    }));
    localStorage.setItem('cc_department_id', '42');
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/housekeeping/event-venues') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(eventData) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], counts: {} }) });
  });
  await page.goto('/housekeeping/events');
  await expect(page.getByRole('heading', { name: 'Event venue work' })).toBeVisible();
  const event = page.getByTestId('venue-event-99');
  await expect(event.getByRole('heading', { name: 'Garden' })).toBeVisible();
  await expect(event).toContainText('EVT-2026-00551');
  await expect(event).toContainText('Before event');
  await expect(event).toContainText('After event');
  await expect(event.getByTestId('venue-task-601')).toContainText('Needs assignment');
  await expect(event.getByTestId('venue-task-603')).toContainText('Done');
  await expect(page.getByRole('link', { name: 'Room cleaning' })).toHaveAttribute('href', '/housekeeping');
  await expect(page.getByRole('link', { name: 'Open tasks' })).toHaveAttribute('href', '/tasks');
  await expect(page.getByRole('link', { name: 'Open event project' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
  await page.getByRole('checkbox', { name: 'Show finished jobs' }).uncheck();
  await expect(event.getByTestId('venue-task-603')).toHaveCount(0);
  await expect(event.getByTestId('venue-task-601')).toBeVisible();
  await page.getByLabel('Find event or venue').fill('Function Hall');
  await expect(page.getByText(/No matching venue jobs/)).toBeVisible();
});

test('room cleaning keeps its own board while linking housekeeping venue jobs', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cc_user', JSON.stringify({
      id: 55, name: 'Fictional cleaner', role: 'staff', department_id: 42,
      departments: [{ id: 42, name: 'Housekeeping', is_primary: true }],
    }));
    localStorage.setItem('cc_department_id', '42');
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/housekeeping/turnovers') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        date: '2026-12-19', can_schedule: false, can_clean: true, can_inspect: false, rooms: [],
      }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });
  await page.goto('/housekeeping');
  await expect(page.getByRole('heading', { name: 'Room cleaning' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Event venue work' })).toHaveAttribute('href', '/housekeeping/events');
});
