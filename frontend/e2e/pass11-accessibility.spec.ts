import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const routes = [
  '/',
  '/account',
  '/admin/approve',
  '/admin/health',
  '/admin/users',
  '/approvals',
  '/approve',
  '/departments',
  '/fixes',
  '/guests',
  '/history',
  '/my-work',
  '/posts',
  '/posts/editor',
  '/projects',
  '/requests',
  '/review',
  '/rooms',
  '/rooms/1',
  '/shift',
  '/tasks',
  '/notifications',
  '/does-not-exist',
];

const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 720 },
];

async function seedAuthenticatedShell(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cc_user', JSON.stringify({ id: 1, name: 'Owner', email: 'owner@example.com', role: 'owner' }));
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, name: 'Owner', email: 'owner@example.com', role: 'owner', can_view_all: true, departments: [] }) });
    }
    if (url.pathname === '/api/meta') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ departments: [], capabilities: [] }) });
    }
    if (url.pathname === '/api/property-media') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
    if (url.pathname.startsWith('/api/property-media/rooms/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false, content_url: null }) });
    }
    if (url.pathname === '/api/rooms/1/memory') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ room: { id: 1, name: 'Room 101', kind: 'room', status: 'active' }, guests: [], fixes: [] }) });
    }
    if (url.pathname === '/api/notifications') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], next_cursor: null, has_more: false, unread_count: 0 }) });
    }
    if (url.pathname.includes('/page?')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], next_cursor: null, has_more: false }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

function persistAxeFailure(label: string, blocking: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  if (!blocking.length) return;
  const outputDir = join(process.cwd(), 'test-results', 'ui-audit');
  mkdirSync(outputDir, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'page';
  writeFileSync(
    join(outputDir, `axe-${safeLabel}.json`),
    JSON.stringify(blocking.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map(node => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    })), null, 2),
  );
}

async function expectNoBlockingAxeViolations(page: Page, label: string) {
  // Next can briefly clear document.title while metadata is being applied after
  // hydration. Wait for a non-empty title, then give the metadata microtask queue
  // one short settle window before axe reads the DOM. This keeps the title check
  // enforced without requiring two samples to be byte-identical during that race.
  await expect.poll(async () => (await page.title()).trim(), { timeout: 5000 }).not.toBe('');
  await page.waitForTimeout(250);
  expect((await page.title()).trim()).not.toBe('');
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = result.violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious');
  persistAxeFailure(label, blocking);
  expect(
    blocking,
    blocking.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`).join('\n'),
  ).toEqual([]);
}

test('login is free of critical/serious WCAG violations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  await expectNoBlockingAxeViolations(page, 'login-mobile-320');
});

for (const viewport of viewports) {
  for (const path of routes) {
    test(`${path} has no critical/serious WCAG violations at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedAuthenticatedShell(page);
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.locator('#__next_error__')).toHaveCount(0);
      await expectNoBlockingAxeViolations(page, `${path}-${viewport.name}`);
    });
  }
}
