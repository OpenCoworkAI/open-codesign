import { defineConfig } from 'vitest/config';
import { requireUiTestLease } from '../../scripts/testing/require-ui-lease.mjs';

requireUiTestLease();
export default defineConfig({
  test: {
    include: ['src/debug/*.integration.test.ts'],
    env: { CODESIGN_UI_DEBUG_INTEGRATION: '1' },
    maxWorkers: 1,
    fileParallelism: false,
  },
});
