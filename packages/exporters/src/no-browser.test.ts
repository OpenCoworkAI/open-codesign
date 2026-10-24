import puppeteer from 'puppeteer-core';
import { expect, it } from 'vitest';

it('rejects a real browser in ordinary export tests even when Chrome is installed', () => {
  expect(() => puppeteer.launch()).toThrow('REAL_BROWSER_DISABLED');
  expect(process.env['CODESIGN_EXPORT_BROWSER_TESTS']).toBe('0');
});
