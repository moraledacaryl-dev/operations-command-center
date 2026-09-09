import { expect, test, type Page } from '@playwright/test';

const departments = [{ id: 3, name: 'Marketing', is_primary: true }];
const owner = { id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner', primary_department_id: 3, departments, capabilities: { view_all_operations: true, manage_department: true, make_decisions: true, manage_accounts: true, manage_system: true, view_system_health: true, manage_approvals: true, view_sensitive_user_metadata: true, view_integration_summary: true } };
const campaign = { id: 41, department_id: 3, name: 'September Escape', objective: 'Drive direct bookings' };
const deliverables = [
  { id: 71, concept_id: 51, concept_title: 'Poolside weekend', content_pillar: 'Stay', campaign_id: 41, campaign_name: 'September Escape', department_id: 3, platform: 'Facebook', format: 'Static', scheduled_at: '2026-09-12T01:00:00Z', status: 'Planned', allowed_actions: [] },
  { id: 72, concept_id: 51, concept_title: 'Poolside weekend', content_pillar: 'Stay', campaign_id: 41, campaign_name: 'September Escape', department_id: 3, platform: 'Instagram', format: 'Reel', scheduled_at: '2026-09-12T01:00:00Z', status: 'Planned', allowed_actions: [] },
];
const concept = { id: 51, campaign_id: 41, title: 'Poolside weekend', content_pillar: 'Stay', brief: 'One concept for multiple channels', campaign, deliverables };
const creative = { id: 81, title: 'Pool hero.png', versions: [{ id: 91, asset_id: 81, version_no: 1, filename: 'pool-hero.png', mime_type: 'image/png', annotatable: true, file_url: '/api/marketing/assets/81/versions/91/download' }] };
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function seed(page: Page) {
  const assets = [creative];
  await page.addInitScript(({ session }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '3');
  }, { session: owner });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/marketing/assets/81/versions/91/download') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng });
      return;
    }
    if (url.pathname === '/api/marketing/concepts/51/assets' && method === 'POST') {
      const uploaded = { id: 82, title: 'new-creative.png', versions: [{ id: 92, asset_id: 82, version_no: 1, filename: 'new-creative.png', mime_type: 'image/png', annotatable: true, file_url: '/api/marketing/assets/82/versions/92/download' }] };
      assets.unshift(uploaded);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(uploaded) });
      return;
    }
    let body: unknown = [];
    if (url.pathname === '/api/auth/me') body = owner;
    else if (url.pathname === '/api/meta') body = { departments };
    else if (url.pathname === '/api/marketing/campaigns') body = [campaign];
    else if (url.pathname === '/api/marketing/concepts') body = [concept];
    else if (url.pathname === '/api/marketing/calendar') body = deliverables;
    else if (url.pathname === '/api/marketing/concepts/51/assets') body = assets;
    else if (url.pathname === '/api/marketing/assets/81/versions') body = creative.versions;
    else if (url.pathname === '/api/posts') body = { items: [], next_cursor: null, has_more: false };
    else if (url.searchParams.get('paginated') === 'true') body = { items: [], next_cursor: null, has_more: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('scheduled multi-platform concept appears in calendar and opens its concept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page);
  await page.clock.setFixedTime(new Date('2026-09-08T06:00:00Z'));
  await page.goto('/posts');
  await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
  const facebook = page.getByRole('button', { name: /Poolside weekend Facebook · Planned/ });
  const instagram = page.getByRole('button', { name: /Poolside weekend Instagram · Planned/ });
  await expect(facebook).toBeVisible();
  await expect(instagram).toBeVisible();
  await facebook.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Poolside weekend' })).toBeVisible();
  await expect(drawer.getByRole('paragraph').filter({ hasText: 'One concept for multiple channels' })).toBeVisible();
  await expect(drawer.getByText('v1 · pool-hero.png')).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Annotate' })).toHaveAttribute('href', '/posts/editor?conceptId=51&assetId=81&versionId=91');
});

test('creative upload confirms success and refreshes the version list', async ({ page }) => {
  await seed(page);
  await page.goto('/posts');
  await page.getByRole('button', { name: /Poolside weekend Facebook · Planned/ }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Upload creative').setInputFiles({ name: 'new-creative.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(drawer.getByRole('status')).toHaveText('Uploaded new-creative.png successfully.');
  await expect(drawer.getByText('v1 · new-creative.png')).toBeVisible();
});

test('new concept uses campaign dropdown, multiple platforms, and creative upload', async ({ page }) => {
  await seed(page);
  await page.goto('/posts');
  await page.getByRole('button', { name: 'New concept' }).click();
  const campaignSelect = page.getByRole('combobox', { name: 'Campaign' });
  await expect(campaignSelect).toBeVisible();
  await expect(campaignSelect).toHaveValue('41');
  await expect(campaignSelect.getByRole('option', { name: 'September Escape' })).toBeAttached();
  await expect(page.getByRole('checkbox', { name: 'Facebook' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Instagram' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'TikTok' })).not.toBeChecked();
  await expect(page.getByLabel('Creative asset')).toHaveAttribute('accept', /image\/png/);
});

test('calendar date is clickable and prefills canonical concept publishing date', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page);
  await page.clock.setFixedTime(new Date('2026-09-08T06:00:00Z'));
  await page.goto('/posts');
  const dateButton = page.getByRole('button', { name: 'Plan content on September 12, 2026' });
  await expect(dateButton).toBeEnabled();
  await dateButton.click();
  await expect(page.getByRole('heading', { name: 'Create multi-platform concept' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Campaign' })).toHaveValue('41');
  await expect(page.getByRole('textbox', { name: 'Concept title' })).toBeFocused();
  await expect(page.getByLabel('Publishing date')).toHaveValue('2026-09-12');
});

test('Annotation Studio auto-fits and supports direct text and image overlays', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seed(page);
  await page.goto('/posts/editor?conceptId=51&assetId=81&versionId=91');
  await expect(page.getByRole('heading', { name: 'Annotation studio' })).toBeVisible();
  await expect(page.getByText('Poolside weekend')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Creative image version' })).toHaveValue('91');
  await expect(page.getByText('pool-hero.png', { exact: true })).toBeVisible();
  await expect(page.getByText('No creative loaded')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Fit · \d+%/ })).toBeEnabled();
  await expect(page.getByLabel('Overlay image')).toBeEnabled();
  await expect(page.getByLabel('Text font size')).toHaveValue('48');
  await page.getByLabel('Overlay image').setInputFiles({ name: 'logo-overlay.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByText('pool-hero.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'T Text' }).click();
  const annotationCanvas = page.locator('canvas').nth(1);
  await annotationCanvas.click({ position: { x: 1, y: 1 } });
  const inlineText = page.getByRole('textbox', { name: 'Text annotation' });
  await expect(inlineText).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Text font size').fill('72');
  await expect(page.getByLabel('Text font size')).toHaveValue('72');
  await inlineText.fill('Pool note');
  await inlineText.press('Enter');
  await expect(inlineText).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save annotated version' })).toBeEnabled();
});
