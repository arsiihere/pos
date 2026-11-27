import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// L-E2E-T1 rows #26 / #27 (03a PK-10, owner ruling DC-1; 05 §6.25, §6.26): the business day closes, so the journey gets
// a hub of its own — the same global setup without the other flows' seeded orders (POS_E2E_DAYCLOSE=1) — instead of
// closing the shared e2e hub's day under every later spec. One language per run (POS_E2E_DAYCLOSE_LANG, en | ur), so each
// language gets a fresh hub and clock; POS_E2E_DAYCLOSE_BEFORE_END_MIN pins the hub's clock that many minutes before the
// business day's end (global-setup; default 600). Run after the client build, e.g.:
//   POS_E2E_DAYCLOSE_LANG=en pnpm --filter @pos/client exec playwright test -c playwright.dayclose.config.ts --trace off
process.env['POS_E2E_DAYCLOSE'] = '1';
const lang = process.env['POS_E2E_DAYCLOSE_LANG'];

export default defineConfig({
  testDir: './e2e',
  testMatch: /t1-dayclose\.spec\.ts$/,
  ...(lang === undefined ? {} : { grep: new RegExp(`\\(${lang}\\)`) }),
  outputDir: join(tmpdir(), 'pos-client-e2e-dayclose-results'),
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'kiosk', use: { viewport: { width: 1920, height: 1080 } } }],
});
