import { defineConfig } from '@playwright/test';
const externalBase = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: './tests/browser', timeout: 90000, expect: { timeout: 15000 }, workers: 1,
  use: { baseURL: externalBase || 'http://127.0.0.1:5173', channel: 'chrome', headless: true, viewport: { width: 1365, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: 'list',
  webServer: externalBase ? undefined : { command: 'pnpm dev', url: 'http://127.0.0.1:5173/api/health', reuseExistingServer: true, timeout: 30000 },
});
