import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    passWithNoTests: true,
    // P-4: the simulator gate runs in the root `perf` project.
    exclude: [...configDefaults.exclude, 'test/sim/**/*.perf.test.ts'],
  },
});
