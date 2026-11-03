import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      // 03a P-4, §10.6: the simulator performance gate.
      {
        test: {
          name: 'perf',
          root: './packages/engine',
          include: ['test/sim/**/*.perf.test.ts'],
          testTimeout: 600_000,
        },
      },
    ],
  },
});
