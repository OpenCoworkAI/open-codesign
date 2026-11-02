import { defineConfig } from 'vitest/config';
import { requireUiTestLease } from '../../scripts/testing/require-ui-lease.mjs';

requireUiTestLease();
export default defineConfig({
  test: {
    include: [
      'src/**/*.browser.test.ts',
      'src/**/*.chrome.test.ts',
      'src/html.test.ts',
      'src/zip.test.ts',
    ],
    env: { CODESIGN_EXPORT_BROWSER_TESTS: '1' },
    maxWorkers: 1,
    fileParallelism: false,
  },
});
