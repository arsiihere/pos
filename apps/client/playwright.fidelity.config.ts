import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// 02b-TK L-CLIENT-6a: the design-fidelity captures (docs/design/handoff/02b-tk/build-shots/<Frame>-<size>.png) on
// demo hubs (e2e/fidelity/setup.ts). Run by hand after `pnpm --filter @pos/client build`:
//   pnpm --filter @pos/client exec playwright test -c playwright.fidelity.config.ts
// Never part of the gate or `pnpm test:e2e`.
export default defineConfig({
  testDir: './e2e/fidelity',
  outputDir: join(tmpdir(), 'pos-client-fidelity-results'),
  globalSetup: './e2e/fidelity/setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off', launchOptions: process.env['PW_CHROMIUM'] === undefined ? {} : { executablePath: process.env['PW_CHROMIUM'] } },
});
