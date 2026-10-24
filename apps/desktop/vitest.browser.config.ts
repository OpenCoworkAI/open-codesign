import { defineConfig } from 'vitest/config';
import { requireUiTestLease } from '../../scripts/testing/require-ui-lease.mjs';

requireUiTestLease();
export default defineConfig({
  test: {
    include: ['src/**/*.browser.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
