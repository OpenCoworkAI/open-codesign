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

  it('falls back to font size and leading-body when line-height is not numeric', () => {
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
});
