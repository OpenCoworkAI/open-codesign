import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl } from './open-external';

describe('isAllowedExternalUrl', () => {
  it('accepts /issues/new URL (Report flow)', () => {
    expect(
      isAllowedExternalUrl(
        'https://github.com/OpenCoworkAI/open-codesign/issues/new?title=x&body=y',
      ),
    ).toBe(true);
  });

  it('accepts /releases URL (update banner)', () => {
    expect(
      isAllowedExternalUrl('https://github.com/OpenCoworkAI/open-codesign/releases/tag/v0.1.0'),
    ).toBe(true);
  });

  it('accepts loopback preview URLs', () => {
    expect(isAllowedExternalUrl('http://localhost:5173/preview')).toBe(true);
    expect(isAllowedExternalUrl('http://127.0.0.1:4173/')).toBe(true);
    expect(isAllowedExternalUrl('http://[::1]:5173/')).toBe(true);
  });

  it('rejects unrelated host', () => {
    expect(
      isAllowedExternalUrl('https://evil.example.com/OpenCoworkAI/open-codesign/issues/new'),
    ).toBe(false);
  });

  it('rejects different repo path on github.com', () => {
    expect(isAllowedExternalUrl('https://github.com/attacker/malicious/issues/new')).toBe(false);
  });

  it('rejects non-https protocols', () => {
    expect(isAllowedExternalUrl('http://github.com/OpenCoworkAI/open-codesign/issues/new')).toBe(
      false,
    );
    expect(
      isAllowedExternalUrl('file:///Users/attacker/OpenCoworkAI/open-codesign/issues/new'),
    ).toBe(false);
  });

  it('rejects malformed URL strings', () => {
    expect(isAllowedExternalUrl('not a url')).toBe(false);
    expect(isAllowedExternalUrl('')).toBe(false);
  });

  it('rejects repo root and other paths like /pulls', () => {
    expect(isAllowedExternalUrl('https://github.com/OpenCoworkAI/open-codesign')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/OpenCoworkAI/open-codesign/pulls/1')).toBe(
      false,
    );
  });

  it('does not accept a prefix-smuggled path like /issuesFAKE', () => {
    // Exact "/issues" or "/issues/..." — not "/issuesEVIL/..."
    expect(isAllowedExternalUrl('https://github.com/OpenCoworkAI/open-codesign/issuesEVIL/1')).toBe(
      false,
    );
  });
});
