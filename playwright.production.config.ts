import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/deployed', timeout: 120000, expect: { timeout: 20000 }, workers: 1,
  outputDir: 'test-results/deployed', reporter: 'list',
  use: {
    baseURL: process.env.DEPLOYMENT_URL || 'https://minigames.19ba.cn',
    channel: 'chrome', headless: true, viewport: { width: 1365, height: 960 },
    navigationTimeout: 20000, actionTimeout: 20000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
});
