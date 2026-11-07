import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    passWithNoTests: true,
    setupFiles: ['./test/helpers/no-cloud-network.ts'],
    // 03a AD-32: wall-clock gates run only in the root `perf-hub` project (pnpm test:perf).
    exclude: [...configDefaults.exclude, 'test/**/*.perf.test.ts'],
  },
});
