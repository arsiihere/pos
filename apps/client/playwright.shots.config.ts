import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// 02b-TK L-CLIENT-6b build shots (owner proof, never the gate): a demo hub (e2e/shots/demo-setup.ts) and the frame
// captures under docs/design/handoff/02b-tk/build-shots/. `TZ=Asia/Karachi pnpm --filter @pos/client exec playwright
// test -c playwright.shots.config.ts` after the client build.
export default defineConfig({
  testDir: './e2e/shots',
  outputDir: join(tmpdir(), 'pos-client-shots'),
  globalSetup: './e2e/shots/demo-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: { trace: 'off', screenshot: 'only-on-failure', actionTimeout: 15_000, locale: 'en-GB', timezoneId: 'Asia/Karachi', ...(process.env['POS_CHROMIUM'] ? { launchOptions: { executablePath: process.env['POS_CHROMIUM'] } } : {}) },
  projects: [
    { name: '1920', use: { viewport: { width: 1920, height: 1080 } } },
    { name: '1366', use: { viewport: { width: 1366, height: 768 } } },
    { name: '1280', use: { viewport: { width: 1280, height: 800 } } },
    { name: '390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
