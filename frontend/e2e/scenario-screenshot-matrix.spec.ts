import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const OUT = 'test-results/ui-audit';
mkdirSync(OUT, { recursive: true });

type Scenario = {
  id: string;
  route: string;
  description: string;
  prepare?: (page: Page) => Promise<void>;
};

async function shot(page: Page, id: string) {
  await expect(page.locator('body')).toBeVisible();
  await page.screenshot({ path: `${OUT}/scenario-${id}.png`, fullPage: true });
}

async function clickFirst(page: Page, names: RegExp[]) {
  for (const name of names) {
    const target = page.getByRole('button', { name }).first();
    if (await target.isVisible().catch(() => false)) {
      await target.click();
      return true;
    }
  }
  return false;
}

const scenarios: Scenario[] = [
  { id: 'tasks-board-populated', route: '/tasks', description: 'Task board with seeded workflow statuses' },
  { id: 'requests-workflow-populated', route: '/requests', description: 'Requests with representative workflow statuses' },
  { id: 'approvals-populated', route: '/approvals', description: 'Approval queue populated state' },
  { id: 'review-populated', route: '/review', description: 'Review queue populated state' },
  { id: 'shift-populated', route: '/shift', description: 'Shift handoff populated state' },
  { id: 'maintenance-populated', route: '/fixes', description: 'Maintenance workflow populated state' },
  { id: 'guest-matters-populated', route: '/guests', description: 'Guest matters populated state' },
  { id: 'notifications-populated', route: '/notifications', description: 'Notifications populated state' },
  { id: 'projects-populated', route: '/projects', description: 'Projects populated state' },
  {
    id: 'mobile-navigation-drawer-open',
    route: '/home',
    description: 'Mobile navigation drawer open',
    prepare: async page => {
      await page.setViewportSize({ width: 390, height: 844 });
      const opened = await clickFirst(page, [/menu/i, /navigation/i, /open/i]);
      expect(opened).toBeTruthy();
    },
  },
  {
    id: 'task-create-surface-open',
    route: '/tasks',
    description: 'Task create modal/drawer open',
    prepare: async page => {
      const opened = await clickFirst(page, [/new task/i, /create task/i, /add task/i]);
      expect(opened).toBeTruthy();
    },
  },
  {
    id: 'request-create-surface-open',
    route: '/requests',
    description: 'Request create modal/drawer open',
    prepare: async page => {
      const opened = await clickFirst(page, [/new request/i, /create request/i, /add request/i]);
      expect(opened).toBeTruthy();
    },
  },
  {
    id: 'maintenance-create-surface-open',
    route: '/fixes',
    description: 'Maintenance issue create modal/drawer open',
    prepare: async page => {
      const opened = await clickFirst(page, [/report issue/i, /new issue/i, /create/i]);
      expect(opened).toBeTruthy();
    },
  },
];

/**
 * This suite intentionally layers scenario/state captures on top of
 * full-site-screenshot-inventory.spec.ts. The existing inventory remains the
 * route × role × viewport baseline; this file certifies interactive states.
 *
 * It reuses the normal browser test application's seeded/mock environment.
 * If a scenario is inaccessible to the current seeded actor, the test fails
 * instead of silently emitting a misleading screenshot.
 */
test.describe('scenario screenshot matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  for (const scenario of scenarios) {
    test(scenario.id, async ({ page }) => {
      await page.goto(scenario.route);
      await page.waitForLoadState('networkidle');
      await scenario.prepare?.(page);
      await shot(page, scenario.id);
    });
  }

  test.afterAll(() => {
    writeFileSync(
      `${OUT}/scenario-manifest.json`,
      JSON.stringify(
        {
          purpose: 'Interactive/state coverage supplement to full-site screenshot inventory',
          scenarios: scenarios.map(({ id, route, description }) => ({ id, route, description })),
          requiredCoverage: {
            baseline: 'route × role × desktop/mobile',
            supplement: [
              'workflow-populated states',
              'navigation drawer open',
              'create modal/drawer surfaces',
            ],
            futureCandidates: [
              'validation errors where deterministic',
              'destructive confirmation dialogs',
              'empty/loading/API-error states',
              'dropdown/popover/date-picker open states',
              'success/error toast states',
              'annotation tool/object editing states',
              'marketing campaign/concept/deliverable editing states',
            ],
          },
        },
        null,
        2,
      ),
    );
  });
});
