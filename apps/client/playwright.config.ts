import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// 02 client e2e (W0.7, owner Q-32): committed Playwright specs under e2e/, run by `pnpm test:e2e` — never in the
// gate (vitest excludes e2e/**). The global setup boots a test hub (apps/hub/test/helpers/test-hub.ts) that serves
// the built /staff/ entry; browsers come from `pnpm --filter @pos/client exec playwright install chromium`.
// Viewports of the plan: tablet landscape and portrait, the cashier kiosk, and two phones.

export default defineConfig({
  testDir: './e2e',
  // traces and screenshots outside the repo (nothing to ignore or commit)
  outputDir: join(tmpdir(), 'pos-client-e2e-results'),
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'tablet-landscape', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'tablet-portrait', use: { viewport: { width: 800, height: 1280 } } },
    { name: 'kiosk', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'phone-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'phone-360', use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
  ],
});
