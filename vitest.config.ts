import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 03a §10.6, AD-32: the `perf` project lives in vitest.perf.config.ts and runs only via `pnpm test:perf`.
    projects: ['packages/*', 'apps/*'],
  },
});
