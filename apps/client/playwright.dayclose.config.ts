import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// L-E2E-T1 rows #26 / #27 (03a PK-10, owner ruling DC-1; 05 §6.25, §6.26): the business day closes, so the journey gets
// a hub of its own — the same global setup without the other flows' seeded orders (POS_E2E_DAYCLOSE=1) — instead of
// closing the shared e2e hub's day under every later spec. Run after the client build:
//   POS_E2E_DAYCLOSE=1 pnpm --filter @pos/client exec playwright test -c playwright.dayclose.config.ts --trace off
process.env['POS_E2E_DAYCLOSE'] = '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: /t1-dayclose\.spec\.ts$/,
  outputDir: join(tmpdir(), 'pos-client-e2e-dayclose-results'),
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'kiosk', use: { viewport: { width: 1920, height: 1080 } } }],
});
