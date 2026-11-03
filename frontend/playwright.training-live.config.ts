import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['live-employee-training.spec.ts', 'live-shift-challenge.spec.ts'],
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:3407',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === 'true' ? 'chrome' : undefined,
    screenshot: 'only-on-failure',
    // Do not put randomized trainer passwords into trace artifacts.
    trace: 'off',
  },
});
