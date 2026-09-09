import { expect, test, type Page } from '@playwright/test';

const departments = [{ id: 3, name: 'Marketing', is_primary: true }];
const owner = { id: 1, name: 'Owner', email: 'owner@example.test', role: 'owner', primary_department_id: 3, departments, capabilities: { view_all_operations: true, manage_department: true, make_decisions: true, manage_accounts: true, manage_system: true, view_system_health: true, manage_approvals: true, view_sensitive_user_metadata: true, view_integration_summary: true } };
const campaign = { id: 41, department_id: 3, name: 'September Escape', objective: 'Drive direct bookings' };
const concept = { id: 51, campaign_id: 41, title: 'Poolside weekend', content_pillar: 'Stay', brief: 'One concept for multiple channels', campaign, deliverables: [] };
const originalVersion = { id: 91, asset_id: 81, version_no: 1, filename: 'pool-hero.png', mime_type: 'image/png', annotatable: true, file_url: '/api/marketing/assets/81/versions/91/download' };
const savedVersion = { id: 92, asset_id: 81, version_no: 2, filename: 'pool-hero-annotated.png', mime_type: 'image/png', annotatable: true, file_url: '/api/marketing/assets/81/versions/92/download' };
const creative = { id: 81, title: 'Pool hero.png', versions: [originalVersion] };
const basePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAIAAAA48Cq8AAABTElEQVR4nO3SwQ3AIBDAsNL9dz6WIEJC9gR5ZM3MB6f9twN4k7FIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi8QGNfcD7QNqWV8AAAAASUVORK5CYII=', 'base64');
const overlayPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

type StudioState = { schema_version: 1; base_version_id: number; objects: Record<string, unknown>[] };

async function seed(page: Page) {
  let created = false;
  let savedState: StudioState | null = null;
  let requestedFlattenedDownload = false;
  await page.addInitScript(({ session }) => {
    localStorage.setItem('cc_user', JSON.stringify(session));
    localStorage.setItem('cc_department_id', '3');
  }, { session: owner });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/marketing/assets/81/versions/91/download') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: basePng });
      return;
    }
    if (url.pathname === '/api/marketing/assets/81/versions/92/download') {
      requestedFlattenedDownload = true;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Annotated preview must not become the editable base.' }) });
      return;
    }
    if (url.pathname === '/api/marketing/assets/81/versions/91/annotation-state') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema_version: 1, base_version_id: 91, objects: [] }) });
      return;
    }
    if (url.pathname === '/api/marketing/assets/81/versions/92/annotation-state') {
      if (request.method() === 'PUT') {
        savedState = request.postDataJSON() as StudioState;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedState) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedState || { schema_version: 1, base_version_id: 91, objects: [] }) });
      }
      return;
    }
    if (url.pathname === '/api/marketing/assets/81/versions' && request.method() === 'POST') {
      created = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedVersion) });
      return;
    }
    let body: unknown = [];
    if (url.pathname === '/api/auth/me') body = owner;
    else if (url.pathname === '/api/meta') body = { departments };
    else if (url.pathname === '/api/marketing/concepts') body = [concept];
    else if (url.pathname === '/api/marketing/assets/81/versions') body = created ? [savedVersion, originalVersion] : creative.versions;
    else if (url.pathname === '/api/posts') body = { items: [], next_cursor: null, has_more: false };
    else if (url.searchParams.get('paginated') === 'true') body = { items: [], next_cursor: null, has_more: false };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return {
    state: () => savedState,
    flattenedWasRequested: () => requestedFlattenedDownload,
  };
}

async function dragOnCanvas(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const canvas = page.locator('canvas').nth(1);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 5 });
  await page.mouse.up();
}

test('Annotation Studio keeps review marks editable, saves state, and restores it from the clean base', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const probe = await seed(page);
  await page.goto('/posts/editor?conceptId=51&assetId=81&versionId=91');
  await expect(page.getByText('pool-hero.png', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '↖ Select' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '→ Arrow' })).toBeVisible();
  await expect(page.getByRole('button', { name: '□ Box' })).toBeVisible();
  await expect(page.getByRole('button', { name: '○ Circle' })).toBeVisible();
  await expect(page.getByRole('button', { name: '✥ Pan' })).toBeVisible();

  await page.getByLabel('Overlay image').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: overlayPng });
  await expect(page.locator('[data-annotation-object="image"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Duplicate' })).toBeEnabled();
  await expect(page.getByLabel('Selected annotation opacity')).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('[data-annotation-object="image"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('[data-annotation-object="image"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'T Text' }).click();
  await page.locator('canvas').nth(1).click({ position: { x: 180, y: 120 } });
  const editor = page.getByRole('textbox', { name: 'Text annotation' });
  await editor.fill('Pool note');
  await editor.press('Enter');
  await expect(page.locator('[data-annotation-object="text"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '↖ Select' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Resize selected annotation')).toBeVisible();
  await page.getByLabel('Text font size').fill('72');
  await expect(page.getByLabel('Text font size')).toHaveValue('72');

  const textHitArea = page.locator('[data-annotation-object="text"] > rect');
  const before = await textHitArea.boundingBox();
  expect(before).not.toBeNull();
  await dragOnCanvas(page, { x: 180, y: 120 }, { x: 210, y: 140 });
  const movedBox = await textHitArea.boundingBox();
  expect(movedBox).not.toBeNull();
  if (before && movedBox) expect(movedBox.x).toBeGreaterThan(before.x + 10);
  await expect(page.getByRole('button', { name: 'Duplicate' })).toBeEnabled();

  await page.getByRole('button', { name: '→ Arrow' }).click();
  await dragOnCanvas(page, { x: 80, y: 70 }, { x: 180, y: 120 });
  await page.getByRole('button', { name: '□ Box' }).click();
  await dragOnCanvas(page, { x: 220, y: 80 }, { x: 320, y: 150 });
  await page.getByRole('button', { name: '○ Circle' }).click();
  await dragOnCanvas(page, { x: 360, y: 80 }, { x: 440, y: 150 });
  await expect(page.locator('[data-annotation-object="arrow"]')).toHaveCount(1);
  await expect(page.locator('[data-annotation-object="rect"]')).toHaveCount(1);
  await expect(page.locator('[data-annotation-object="ellipse"]')).toHaveCount(1);

  await page.getByRole('button', { name: '✎ Pen' }).click();
  await dragOnCanvas(page, { x: 80, y: 200 }, { x: 180, y: 220 });
  await expect(page.locator('[data-annotation-object="pen"]')).toHaveCount(1);
  await page.getByRole('button', { name: '⌫ Eraser' }).click();
  await page.locator('canvas').nth(1).click({ position: { x: 130, y: 210 } });
  await expect(page.locator('[data-annotation-object="pen"]')).toHaveCount(0);
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.locator('[data-annotation-object="pen"]')).toHaveCount(1);

  const objectCount = await page.locator('[data-annotation-object]').count();
  await page.getByRole('button', { name: 'Save annotated version' }).click();
  await expect(page.getByText('Saved as a new creative version with editable review objects. Original preserved.')).toBeVisible();
  expect(probe.state()?.schema_version).toBe(1);
  expect(probe.state()?.base_version_id).toBe(91);
  expect(probe.state()?.objects).toHaveLength(objectCount);

  await page.getByLabel('Creative image version').selectOption('92');
  await page.getByRole('button', { name: 'Open version' }).click();
  await expect(page.getByText(`Restored ${objectCount} editable annotations from this version.`)).toBeVisible();
  await expect(page.locator('[data-annotation-object]')).toHaveCount(objectCount);
  expect(probe.flattenedWasRequested()).toBe(false);
});
