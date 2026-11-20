import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    globalSetup: ['./test/helpers/global-setup.ts'],
    fileParallelism: false,
    passWithNoTests: true,
    // 03a AD-32 (owner ruling 2026-11-20): wall-clock asserts run only in the root `perf-cloud` project (pnpm test:perf).
    exclude: [...configDefaults.exclude, 'test/**/*.perf.test.ts'],
  },
});
