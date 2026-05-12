import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTrustedMainWindowNavigationUrl } from './navigation-policy';

describe('isTrustedMainWindowNavigationUrl', () => {
  it('allows same-origin dev-server navigation', () => {
    expect(
      isTrustedMainWindowNavigationUrl(
        'http://localhost:5173/dashboard?tab=files',
        'http://localhost:5173/',
      ),
    ).toBe(true);
  });

  it('rejects remote navigation away from the dev app origin', () => {
    expect(isTrustedMainWindowNavigationUrl('https://example.com', 'http://localhost:5173/')).toBe(
      false,
    );
  });

  it('rejects same-host navigation on a different port', () => {
    expect(
      isTrustedMainWindowNavigationUrl('http://localhost:3000/', 'http://localhost:5173/'),
    ).toBe(false);
  });

  it('allows hash navigation on the packaged renderer file', () => {
    const trusted = pathToFileURL('/Applications/Open CoDesign.app/Contents/renderer/index.html');
    const target = new URL('#workspace', trusted);

    expect(isTrustedMainWindowNavigationUrl(target.href, trusted.href)).toBe(true);
  });

  it('rejects other file URLs when the packaged renderer is trusted', () => {
    const trusted = pathToFileURL('/Applications/Open CoDesign.app/Contents/renderer/index.html');
    const target = pathToFileURL('/Users/user/Documents/notes.md');

    expect(isTrustedMainWindowNavigationUrl(target.href, trusted.href)).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isTrustedMainWindowNavigationUrl('not a url', 'http://localhost:5173/')).toBe(false);
    expect(isTrustedMainWindowNavigationUrl('https://example.com', 'not a url')).toBe(false);
  });
});
