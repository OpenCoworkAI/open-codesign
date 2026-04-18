import { describe, expect, it } from 'vitest';
import { readIframeErrorMessage } from './App';

describe('readIframeErrorMessage', () => {
  it('ignores iframe errors while a new generation is in progress', () => {
    const data = {
      __codesign: true,
      type: 'IFRAME_ERROR',
      kind: 'error',
      message: 'old preview failed',
      timestamp: Date.now(),
    };

    expect(readIframeErrorMessage(true, data)).toBeNull();
  });

  it('returns the iframe error message when generation is idle', () => {
    const data = {
      __codesign: true,
      type: 'IFRAME_ERROR',
      kind: 'error',
      message: 'current preview failed',
      timestamp: Date.now(),
    };

    expect(readIframeErrorMessage(false, data)).toBe('current preview failed');
  });
});
