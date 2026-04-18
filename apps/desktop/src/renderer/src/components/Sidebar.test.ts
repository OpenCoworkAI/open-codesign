import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTextareaLineHeight } from './Sidebar';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getTextareaLineHeight', () => {
  it('uses the computed line-height when available', () => {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({ lineHeight: '24px', fontSize: '13px', getPropertyValue: vi.fn(() => '') })),
    );

    expect(getTextareaLineHeight({} as HTMLTextAreaElement)).toBe(24);
  });

  it('returns fontSize * leading when line-height is not numeric but tokens are present', () => {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(
        () =>
          ({
            lineHeight: 'normal',
            fontSize: '13px',
            getPropertyValue: vi.fn((name: string) => (name === '--leading-body' ? '1.6' : '')),
          }) as unknown as CSSStyleDeclaration,
      ),
    );

    expect(getTextareaLineHeight({} as HTMLTextAreaElement)).toBeCloseTo(20.8);
  });

  it('throws when sizing tokens are missing or invalid', () => {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(
        () =>
          ({
            lineHeight: 'normal',
            fontSize: 'normal',
            getPropertyValue: vi.fn(() => ''),
          }) as unknown as CSSStyleDeclaration,
      ),
    );

    expect(() => getTextareaLineHeight({} as HTMLTextAreaElement)).toThrow(/missing or invalid/);
  });
});
