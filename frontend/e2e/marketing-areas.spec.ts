import { expect, test, type Page } from '@playwright/test';

const session = { id: 85, name: 'Demo Marketing lead', role: 'lead', email: 'marketing@training.invalid',
  primary_department_id: 4, departments: [{ id: 4, name: 'Marketing', is_primary: true }],
  capabilities: { manage_department: true, view_all_operations: false, make_decisions: false, manage_accounts: false } };

async function mockMarketing(page: Page) {
  const campaigns: any[] = [{ id: 1, name: 'Older campaign', department_id: 4, marketing_areas: null }];
  const concepts: any[] = [];
  const calendar: any[] = [];
  const createdCampaigns: any[] = [];
  const createdPosts: any[] = [];
  await page.addInitScript(s => {
    localStorage.setItem('cc_user', JSON.stringify(s));
    localStorage.setItem('cc_department_id', '4');
  }, session);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()); const method = route.request().method();
    let body: any = [];
    if (path.pathname === '/api/auth/me') body = session;
    else if (path.pathname === '/api/meta') body = { users: [], departments: session.departments };
    else if (path.pathname === '/api/marketing/campaigns' && method === 'POST') {
      const data = route.request().postDataJSON();
      createdCampaigns.push(data);
      body = { ...data, id: 100 + createdCampaigns.length }; campaigns.unshift(body);
    } else if (path.pathname === '/api/marketing/campaigns') body = campaigns;
    else if (path.pathname === '/api/marketing/concepts' && method === 'POST') {
      const data = route.request().postDataJSON();
      createdPosts.push(data);
      const id = 300 + createdPosts.length;
      const deliverables = [{ id: 500 + createdPosts.length, concept_id: id, platform: data.platforms[0],
        format: data.format, status: 'Planned', scheduled_at: null, allowed_actions: [] }];
      const row = { id, ...data, campaign: campaigns.find(item => item.id === data.campaign_id), deliverables };
      concepts.unshift(row);
      calendar.unshift({ ...deliverables[0], concept_title: data.title, campaign_name: row.campaign?.name,
        campaign_id: data.campaign_id, department_id: 4, marketing_areas: data.marketing_areas });
      body = { concept: row, deliverables };
    }
    else if (path.pathname === '/api/marketing/concepts') body = concepts;
    else if (path.pathname === '/api/marketing/calendar') body = calendar;
    else if (path.pathname.startsWith('/api/marketing/concepts/') && path.pathname.endsWith('/assets')) body = [];
    else if (path.pathname === '/api/posts') body = { items: [], next_cursor: null, has_more: false };
    else if (path.pathname === '/api/notifications') body = { items: [], unread_count: 0, next_cursor: null, has_more: false };
    else if (path.searchParams.get('paginated') === 'true') body = { items: [], next_cursor: null, has_more: false };
    if (path.searchParams.get('paginated') === 'true' && Array.isArray(body))
      body = { items: body, next_cursor: null, has_more: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { campaigns, concepts, calendar, createdCampaigns, createdPosts };
}

test('new Marketing employee can tag and find a Pool-only and combined Café/Bar promotion', async ({ page }) => {
  const work = await mockMarketing(page);
  await page.goto('/posts');
  await expect(page.getByRole('heading', { name: 'Multi-platform calendar' })).toBeVisible();

  async function create(name: string, areas: string[]) {
    await page.getByRole('button', { name: 'New campaign' }).click();
    await page.getByLabel('Campaign name').fill(name);
    for (const area of areas) await page.getByRole('checkbox', { name: area }).first().check();
    await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New post for several platforms' })).toBeVisible();
    await page.getByLabel('Post title').fill(name + ' post');
    for (const area of areas) await page.getByRole('checkbox', { name: area }).first().check();
    await page.getByRole('checkbox', { name: 'Facebook' }).check();
    await page.getByRole('button', { name: 'Create 1 post' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'New campaign' })).toBeEnabled();
  }

  await create('Pool day', ['Pool']);
  await expect.poll(() => work.createdCampaigns.length).toBe(1);
  expect(work.createdCampaigns[0].marketing_areas).toEqual(['Pool']);
  expect(work.createdPosts[0].marketing_areas).toEqual(['Pool']);

  await create('Coffee and mocktails', ['Café', 'Bar']);
  expect(work.createdCampaigns[1].marketing_areas).toEqual(['Café', 'Bar']);
  expect(work.createdPosts[1].marketing_areas).toEqual(['Café', 'Bar']);

  const filter = page.getByLabel('Filter Marketing by area');
  await filter.selectOption('Pool');
  await expect(page.getByRole('button', { name: /Pool day post/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Coffee and mocktails post/ })).toHaveCount(0);
  await filter.selectOption('Bar');
  await expect(page.getByRole('button', { name: /Coffee and mocktails post/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pool day post/ })).toHaveCount(0);
  await filter.selectOption('Café');
  await expect(page.getByRole('button', { name: /Coffee and mocktails post/ })).toBeVisible();
  await filter.selectOption('Not set');
  await expect(page.getByRole('button', { name: /Pool day post/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Coffee and mocktails post/ })).toHaveCount(0);
  await expect(page.getByText('Older work stays under Areas not set')).toBeVisible();
});
