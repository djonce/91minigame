import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/player-gestures.spec.ts',
  outputDir: 'test-results/touch',
  use: { ...base.use, channel: undefined },
  projects: [
    { name: 'chrome-touch', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'webkit-touch', use: { browserName: 'webkit' } },
  ],
});
