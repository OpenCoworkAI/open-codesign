import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Export suites launch Chromium per render and may keep an auxiliary browser
    // open. Serialize them on CI so parallel workspace tests do not starve startup.
    maxWorkers: process.env['CI'] ? 1 : process.platform === 'win32' ? 2 : undefined,
  },
});
