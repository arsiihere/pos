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
          // P-4, task 18: wall-clock gates. One file at a time, after every other project.
          maxWorkers: 1,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
