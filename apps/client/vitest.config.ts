import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // W0.7 (Q-32): the Playwright specs run through `pnpm test:e2e`, never in the gate
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
