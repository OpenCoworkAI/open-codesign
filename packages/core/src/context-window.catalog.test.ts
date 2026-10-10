import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from './context-window.js';

describe('resolveContextWindow with the installed pi-ai catalog', () => {
  it('falls back to the default for a provider and model the catalog does not know', () => {
    expect(
      resolveContextWindow(
        { provider: 'codesign-test-relay', modelId: 'codesign-test-unlisted-model' },
        undefined,
        undefined,
      ),
    ).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});
