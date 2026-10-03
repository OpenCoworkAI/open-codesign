import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Concurrent Chromium and filesystem suites exhaust Windows and macOS hosts.
    maxWorkers: process.platform === 'linux' ? undefined : 2,
  },
});
