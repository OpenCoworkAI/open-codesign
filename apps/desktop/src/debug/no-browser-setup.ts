import { vi } from 'vitest';

// A misclassified test must fail rather than silently launch a real browser.
// File-local mocks still provide the Puppeteer behavior needed by unit tests.
vi.mock('puppeteer-core', () => {
  const denied = () => {
    throw new Error('REAL_BROWSER_DISABLED: use the supervised test:browser command');
  };
  return { default: { launch: denied, connect: denied }, launch: denied, connect: denied };
});
