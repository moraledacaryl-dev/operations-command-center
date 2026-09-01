import { defineConfig, devices } from '@playwright/test';

const port = 3310;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === 'true' ? 'chrome' : undefined } },
  ],
  webServer: {
    command: `npm run build && PORT=${port} HOSTNAME=127.0.0.1 node .next/standalone/server.js`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
