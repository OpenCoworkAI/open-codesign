import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      '**/*.browser.test.*',
      '**/*.chrome.test.*',
      'src/debug/*.integration.test.ts',
    ],
    setupFiles: ['src/debug/no-browser-setup.ts'],
    env: { CODESIGN_UI_DEBUG_INTEGRATION: '0' },
    maxWorkers: process.env['CI'] || process.platform === 'win32' ? 2 : undefined,
  },
});
