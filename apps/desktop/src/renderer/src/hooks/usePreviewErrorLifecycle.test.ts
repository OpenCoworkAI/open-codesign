import { useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import { usePreviewErrorLifecycle } from './usePreviewErrorLifecycle';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useLayoutEffect: vi.fn() };
});

function commitEffect(): void {
  const effect = vi.mocked(useLayoutEffect).mock.calls.at(-1)?.[0];
  expect(effect).toBeDefined();
  effect?.();
}

beforeEach(() => {
  vi.mocked(useLayoutEffect).mockClear();
  useCodesignStore.setState({ iframeErrors: ['Incomplete earlier JSX'] });
});

describe('preview error document lifecycle', () => {
  it('clears an earlier document error before a replacement renders', () => {
    usePreviewErrorLifecycle('<main>Repaired</main>', 'design:App.jsx');
    commitEffect();
    expect(useCodesignStore.getState().iframeErrors).toEqual([]);
  });

  it('retains errors reported by the new document after the reset', () => {
    usePreviewErrorLifecycle('<main>Still broken</main>', 'design:App.jsx');
    commitEffect();
    useCodesignStore.getState().pushIframeError('Current document failure');
    expect(useCodesignStore.getState().iframeErrors).toEqual(['Current document failure']);
  });

  it('does not let a background pooled preview clear the active document errors', () => {
    usePreviewErrorLifecycle('<main>Background</main>', 'other-design', false);
    commitEffect();
    expect(useCodesignStore.getState().iframeErrors).toEqual(['Incomplete earlier JSX']);
  });

  it('resets errors when switching to a non-runtime file', () => {
    usePreviewErrorLifecycle(null, 'design:DESIGN.md');
    commitEffect();
    expect(useCodesignStore.getState().iframeErrors).toEqual([]);
  });

  it('keys the layout effect to the rendered document, source identity and active state', () => {
    usePreviewErrorLifecycle('source', 'design:App.jsx', true);
    expect(vi.mocked(useLayoutEffect).mock.calls[0]?.[1]).toEqual([
      'source',
      'design:App.jsx',
      true,
    ]);
  });
});
