import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  elapsedSecondsSince,
  formatElapsedSeconds,
  getTextareaLineHeight,
  getTextareaVerticalPadding,
  shouldSubmitPromptKey,
} from './chat/PromptInput';

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

describe('getTextareaVerticalPadding', () => {
  it('sums textarea vertical padding and treats invalid values as zero', () => {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(
        () =>
          ({
            paddingTop: '5px',
            paddingBottom: '7px',
          }) as unknown as CSSStyleDeclaration,
      ),
    );

    expect(getTextareaVerticalPadding({} as HTMLTextAreaElement)).toBe(12);
  });
});

describe('shouldSubmitPromptKey', () => {
  it('submits on Enter and command/control Enter outside IME composition', () => {
    expect(shouldSubmitPromptKey({ key: 'Enter' })).toBe(true);
    expect(shouldSubmitPromptKey({ key: 'Enter', metaKey: true })).toBe(true);
    expect(shouldSubmitPromptKey({ key: 'Enter', ctrlKey: true })).toBe(true);
  });

  it('does not submit on Shift+Enter', () => {
    expect(shouldSubmitPromptKey({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  it('does not submit while an IME composition is active', () => {
    expect(shouldSubmitPromptKey({ key: 'Enter', isComposing: true })).toBe(false);
    expect(shouldSubmitPromptKey({ key: 'Enter', nativeIsComposing: true })).toBe(false);
    expect(shouldSubmitPromptKey({ key: 'Enter', keyCode: 229 })).toBe(false);
    expect(shouldSubmitPromptKey({ key: 'Enter' }, true)).toBe(false);
  });
});

describe('elapsed generation timer helpers', () => {
  it('derives elapsed seconds from the generation start timestamp', () => {
    expect(elapsedSecondsSince(10_000, 35_400)).toBe(25);
    expect(elapsedSecondsSince(10_000, 9_000)).toBe(0);
  });

  it('formats elapsed seconds as seconds first and mm:ss after a minute', () => {
    expect(formatElapsedSeconds(25)).toBe('25s');
    expect(formatElapsedSeconds(65)).toBe('1:05');
  });
});
