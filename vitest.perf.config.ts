import { defineConfig } from 'vitest/config';

// 03a P-4, §10.6: the simulator performance gate. AD-32: out of `pnpm -w test`;
// it runs only as `pnpm test:perf` (tools/test-perf.sh), inside a clean measurement.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'perf',
          root: './packages/engine',
          include: ['test/sim/**/*.perf.test.ts'],
          testTimeout: 600_000,
          // P-4, task 18: wall-clock gates. One file at a time.
          maxWorkers: 1,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
