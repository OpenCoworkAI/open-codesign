import puppeteer from 'puppeteer-core';
import { expect, it } from 'vitest';

it('rejects an accidental real browser launch or attachment in the ordinary suite', () => {
  expect(() => puppeteer.launch()).toThrow('REAL_BROWSER_DISABLED');
  expect(() => puppeteer.connect({ browserURL: 'http://localhost:9222' })).toThrow(
    'REAL_BROWSER_DISABLED',
  );
  expect(process.env['CODESIGN_UI_DEBUG_INTEGRATION']).toBe('0');
});
