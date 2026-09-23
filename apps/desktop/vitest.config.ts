import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Concurrent Chromium and filesystem suites otherwise exhaust Windows hosts.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
  },
});
