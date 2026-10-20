import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Bound concurrent Chromium and filesystem suites on CI and Windows hosts.
    maxWorkers: process.env['CI'] || process.platform === 'win32' ? 2 : undefined,
  },
});
