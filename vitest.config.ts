import { defineConfig } from 'vitest/config';

// The gate runs in the owner's and the restaurant's zone, as CI does (.github/workflows/gate.yml `TZ: Asia/Karachi`):
// some tests compare local offsets, and a UTC cloud container would otherwise fail them (e.g. -0 vs 0 in
// apps/hub/test/queries/stock.int.test.ts). Set before any worker starts, so every project inherits it.
process.env.TZ = 'Asia/Karachi';

export default defineConfig({
  test: {
    // 03a §10.6, AD-32: the `perf` project lives in vitest.perf.config.ts and runs only via `pnpm test:perf`.
    projects: ['packages/*', 'apps/*'],
  },
});
