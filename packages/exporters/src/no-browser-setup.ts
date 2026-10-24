import { vi } from 'vitest';

// Match the desktop unit guard without requiring desktop development dependencies.
vi.mock('puppeteer-core', () => {
  const denied = () => {
    throw new Error('REAL_BROWSER_DISABLED: use the supervised test:browser command');
  };
  return { default: { launch: denied, connect: denied }, launch: denied, connect: denied };
});
