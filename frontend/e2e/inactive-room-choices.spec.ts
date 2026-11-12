import { expect, test } from '@playwright/test';
import { TRAINING_LESSONS } from '../lib/interactive-training';

test('old rooms remain readable in history but cannot be chosen for new work', async ({ page }) => {
  const user = { id: 901, name: 'Demo manager', role: 'manager', is_active: true,
    primary_department_id: 1, departments: [{ id: 1, name: 'Front Desk', is_primary: true }],
    capabilities: { manage_department: true, make_decisions: true, view_all_operations: true } };
  const rooms = [{ id: 1, name: 'Room 201', kind: 'room', status: 'inactive' },
    { id: 2, name: 'Solace', kind: 'room', status: 'active' }];
  await page.addInitScript(({ account, passed }) => {
    localStorage.setItem('cc_user', JSON.stringify(account));
    localStorage.setItem('cc_department_id', '1');
    localStorage.setItem('ho-ops-structured-course-v2:901', JSON.stringify({ lessonId: 'orientation', stage: 'finished', question: 0, passed }));
  }, { account: user, passed: TRAINING_LESSONS.map(lesson => lesson.id) });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === '/api/auth/me') data = user;
    else if (url.pathname === '/api/meta') data = { users: [user], departments: user.departments };
    else if (url.pathname === '/api/rooms') data = rooms;
    else if (url.pathname === '/api/guests') data = [{ id: 3, title: 'Earlier guest matter', room_area_id: 1, status: 'Open', issue_type: 'Room', guest_name: 'Demo' }];
    else if (url.pathname === '/api/fixes') data = [{ id: 4, title: 'Earlier maintenance', room_area_id: 1, status: 'Working', urgency: 'Normal' }];
    else if (url.pathname === '/api/notifications') data = { items: [], unread_count: 0, has_more: false };
    else if (url.pathname.endsWith('/page')) data = { items: [], has_more: false, next_cursor: null };
    return route.fulfill({ status: 200, json: data });
  });
  for (const [path, button, form] of [['/guests', 'create-guest', 'create-guest-form'], ['/fixes', 'create-fix', 'create-fix-form']]) {
    await page.goto(path);
    await expect(page.getByText('Room 201').first()).toBeVisible();
    await page.getByTestId(button).click();
    const select = page.getByTestId(form).getByLabel('Room / area');
    await expect(select.locator('option', { hasText: 'Solace' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: 'Room 201' })).toHaveCount(0);
  }
});
