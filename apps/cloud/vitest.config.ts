import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    globalSetup: ['./test/helpers/global-setup.ts'],
    fileParallelism: false,
    passWithNoTests: true,
  },
});
