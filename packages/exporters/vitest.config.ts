import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.browser.test.*', '**/*.chrome.test.*'],
    setupFiles: ['src/no-browser-setup.ts'],
    env: { CODESIGN_EXPORT_BROWSER_TESTS: '0' },
    maxWorkers: process.env['CI'] ? 1 : process.platform === 'win32' ? 2 : undefined,
  },
});
