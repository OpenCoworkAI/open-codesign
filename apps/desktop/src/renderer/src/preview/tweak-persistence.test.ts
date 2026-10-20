import {
  type EditmodeTokens,
  parseEditmodeBlock,
  replaceEditmodeBlock,
} from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  createTweakPersistDebounce,
  mergeTweakTokenChanges,
  persistTweakTokensToWorkspace,
  rebaseTweakDraft,
  resolveTweakWriteTarget,
  type WorkspacePreviewWrite,
} from './tweak-persistence';
import type { WorkspacePreviewRead } from './workspace-source';

const jsxSource = 'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accent":"#000000"}/*EDITMODE-END*/;';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('tweak save debounce', () => {
  it('serializes slow saves, coalesces edits, and rebases only on the accepted own output', async () => {
    vi.useFakeTimers();
    try {
      const base = 'const t = /*EDITMODE-BEGIN*/{"heading":"Original","gap":16}/*EDITMODE-END*/;';
      const accepted = base.replace('Original', 'First').replace('"gap":16', '"gap":24');
      const first = deferred<{ content: string; path: string; wrote: boolean }>();
      const idle = vi.fn();
      const debounce = createTweakPersistDebounce(idle);
      const save = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue({
          content: accepted.replace('First', 'Final'),
          path: 'App.jsx',
          wrote: true,
        });
      debounce.schedule(base, { heading: 'First', gap: 16 }, save);
      await vi.advanceTimersByTimeAsync(400);
      debounce.schedule(base, { heading: 'Second', gap: 16 }, save);
      await vi.advanceTimersByTimeAsync(400);
      debounce.schedule(base, { heading: 'Final', gap: 16 }, save);
      await vi.advanceTimersByTimeAsync(400);
      expect(save).toHaveBeenCalledTimes(1);
      expect(debounce.hasPending()).toBe(true);
      first.resolve({ content: accepted, path: 'App.jsx', wrote: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith(accepted, { heading: 'Final', gap: 24 });
      expect(idle).toHaveBeenCalledOnce();
      expect(debounce.hasPending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not treat a queued return to the original value as unchanged from the saved edit', () => {
    expect(
      rebaseTweakDraft(
        '/*EDITMODE-BEGIN*/{"heading":"First","gap":24}/*EDITMODE-END*/',
        { heading: 'First', gap: 16 },
        { heading: 'Original', gap: 16 },
      ),
    ).toEqual({ heading: 'Original', gap: 24 });
  });

  it('drops queued edits after a reported failure without retrying', async () => {
    vi.useFakeTimers();
    try {
      const first = deferred<undefined>();
      const debounce = createTweakPersistDebounce();
      const save = vi.fn().mockReturnValue(first.promise);
      debounce.schedule(jsxSource, { accent: '#123456' }, save);
      await vi.advanceTimersByTimeAsync(400);
      debounce.schedule(jsxSource, { accent: '#abcdef' }, save);
      await vi.advanceTimersByTimeAsync(400);
      first.resolve(undefined);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(save).toHaveBeenCalledTimes(1);
      expect(debounce.hasPending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never rebases a new identity with a cancelled save ACK', async () => {
    vi.useFakeTimers();
    try {
      const first = deferred<{ content: string; path: string; wrote: boolean }>();
      const debounce = createTweakPersistDebounce();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
      debounce.schedule(jsxSource, { accent: '#123456' }, save);
      await vi.advanceTimersByTimeAsync(400);
      debounce.cancel();
      const other = jsxSource.replace('#000000', '#ffffff');
      debounce.schedule(other, { accent: '#fedcba' }, save);
      await vi.advanceTimersByTimeAsync(400);
      first.resolve({
        content: jsxSource.replace('#000000', '#123456'),
        path: 'App.jsx',
        wrote: true,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenLastCalledWith(other, { accent: '#fedcba' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the first baseline during continuous typing across an external source refresh', async () => {
    vi.useFakeTimers();
    try {
      const base = 'const t = /*EDITMODE-BEGIN*/{"gap":16,"heading":"Lab"}/*EDITMODE-END*/;';
      const revised = base.replace('"gap":16', '"gap":26');
      const debounce = createTweakPersistDebounce();
      const save = vi.fn(async (source: string, tokens: EditmodeTokens) => ({
        content: mergeTweakTokenChanges(revised, source, tokens),
        path: 'App.jsx',
        wrote: true,
      }));
      debounce.schedule(base, { gap: 16, heading: 'Lab1' }, save);
      await vi.advanceTimersByTimeAsync(300);
      debounce.schedule(revised, { gap: 16, heading: 'Lab12' }, save);
      await vi.advanceTimersByTimeAsync(300);
      debounce.schedule(revised, { gap: 16, heading: 'Lab123' }, save);
      await vi.advanceTimersByTimeAsync(399);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledExactlyOnceWith(base, { gap: 16, heading: 'Lab123' });
      expect(
        parseEditmodeBlock((await save.mock.results[0]?.value)?.content ?? '')?.tokens,
      ).toEqual({
        gap: 26,
        heading: 'Lab123',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending identity-bound write and starts the next edit with a fresh baseline', async () => {
    vi.useFakeTimers();
    try {
      const debounce = createTweakPersistDebounce();
      const oldDesignSave = vi.fn();
      const newDesignSave = vi.fn();
      debounce.schedule('old design', {}, oldDesignSave);
      await vi.advanceTimersByTimeAsync(200);
      debounce.cancel();
      debounce.schedule('new design', {}, newDesignSave);
      await vi.advanceTimersByTimeAsync(400);
      expect(oldDesignSave).not.toHaveBeenCalled();
      expect(newDesignSave).toHaveBeenCalledExactlyOnceWith('new design', {});
      expect(debounce.hasPending()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resolveTweakWriteTarget', () => {
  it('uses App.jsx as the default tweak source file', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => ({
      path,
      content: jsxSource,
    }));

    await expect(
      resolveTweakWriteTarget({ designId: 'd1', previewSource: jsxSource, read }),
    ).resolves.toEqual({ path: 'App.jsx', content: jsxSource });
  });

  it('resolves an index.html source-reference placeholder to the referenced JSX file', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => {
      if (path === 'App.jsx') throw new Error('missing default source');
      return {
        path,
        content:
          path === 'index.html'
            ? '<!doctype html><body><!-- artifact source lives in index.jsx --></body>'
            : jsxSource,
      };
    });

    await expect(
      resolveTweakWriteTarget({ designId: 'd1', previewSource: jsxSource, read }),
    ).resolves.toEqual({ path: 'index.jsx', content: jsxSource });
  });
});

describe('persistTweakTokensToWorkspace', () => {
  it('writes the rewritten EDITMODE block to the resolved workspace source file', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => ({
      path,
      content: jsxSource,
    }));
    const write = vi.fn<WorkspacePreviewWrite>(async (_designId, path, content) => ({
      path,
      content,
    }));

    const result = await persistTweakTokensToWorkspace({
      designId: 'd1',
      previewSource: jsxSource,
      tokens: { accent: '#f97316' },
      read,
      write,
    });

    expect(result).toMatchObject({ path: 'App.jsx', wrote: true });
    expect(result.content).toContain('"accent": "#f97316"');
    expect(write).toHaveBeenCalledWith('d1', 'App.jsx', expect.stringContaining('#f97316'), {
      expectedContent: jsxSource,
    });
  });

  it('falls back to renderer-only content when no write API is available', async () => {
    const result = await persistTweakTokensToWorkspace({
      designId: 'd1',
      previewSource: jsxSource,
      tokens: { accent: '#22c55e' },
    });

    expect(result).toMatchObject({ path: 'App.jsx', wrote: false });
    expect(result.content).toContain('"accent": "#22c55e"');
  });

  it('targets the displayed second file even when App.jsx exists', async () => {
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => ({
      path,
      content: jsxSource,
    }));
    const write = vi.fn<WorkspacePreviewWrite>(async (_designId, path, content) => ({
      path,
      content,
    }));
    await persistTweakTokensToWorkspace({
      designId: 'd1',
      path: 'screens/Details.jsx',
      previewSource: jsxSource,
      tokens: { accent: '#123456' },
      read,
      write,
    });
    expect(read).toHaveBeenCalledExactlyOnceWith('d1', 'screens/Details.jsx');
    expect(write.mock.calls[0]?.[1]).toBe('screens/Details.jsx');
  });

  it('does not fall back to App.jsx when an explicit target is missing', async () => {
    const read = vi.fn<WorkspacePreviewRead>().mockRejectedValue(new Error('File missing'));
    const write = vi.fn<WorkspacePreviewWrite>();
    await expect(
      persistTweakTokensToWorkspace({
        designId: 'd1',
        path: 'screens/Details.jsx',
        previewSource: jsxSource,
        tokens: { accent: '#123456' },
        read,
        write,
      }),
    ).rejects.toThrow('File missing');
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    'design switch',
    'generation start',
  ])('rejects a save invalidated during its read by %s', async () => {
    let writable = true;
    const read = vi.fn<WorkspacePreviewRead>(async (_designId, path) => {
      writable = false;
      return { path, content: jsxSource };
    });
    const write = vi.fn<WorkspacePreviewWrite>();
    await expect(
      persistTweakTokensToWorkspace({
        designId: 'original-design',
        path: 'App.jsx',
        previewSource: jsxSource,
        tokens: { accent: '#123456' },
        read,
        write,
        canWrite: () => writable,
      }),
    ).rejects.toThrow('cancelled');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('mergeTweakTokenChanges', () => {
  const base =
    '// preserve formatting\nconst TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"gap":16,"heading":"Original","showNotes":true}/*EDITMODE-END*/;\nconst sentinel = "untouched";';

  it('preserves later agent edits to other values and all surrounding source', () => {
    const revised = base.replace('"gap":16', '"gap":26').replace('"Original"', '"Agent revised"');
    const result = mergeTweakTokenChanges(revised, base, {
      gap: 16,
      heading: 'Original',
      showNotes: false,
    });
    expect(parseEditmodeBlock(result)?.tokens).toEqual({
      gap: 26,
      heading: 'Agent revised',
      showNotes: false,
    });
    expect(replaceEditmodeBlock(result, {})).toBe(replaceEditmodeBlock(revised, {}));
  });

  it('rejects conflicting edits to the same key instead of overwriting the agent', () => {
    expect(() =>
      mergeTweakTokenChanges(base.replace('"gap":16', '"gap":26'), base, { gap: 18 }),
    ).toThrow('changed in the source');
  });

  it('rejects deleted blocks and stale keys without recreating them', () => {
    expect(() => mergeTweakTokenChanges('const other = 1;', base, { gap: 18 })).toThrow(
      'no longer contains',
    );
    expect(() => mergeTweakTokenChanges(base.replace('"gap":16,', ''), base, { gap: 18 })).toThrow(
      'changed in the source',
    );
  });

  it.each([
    1000,
    Number.POSITIVE_INFINITY,
    Number.NaN,
  ])('rejects unsafe numeric input %s', (gap) => {
    const source = `${base}\nconst TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{"gap":{"kind":"number","min":8,"max":32,"step":2}}/*TWEAK-SCHEMA-END*/;`;
    expect(() => mergeTweakTokenChanges(source, source, { gap })).toThrow('supported range');
  });

  it('rejects invalid options and primitive type changes', () => {
    const source = `${base}\nconst TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{"heading":{"kind":"enum","options":["Original","Alternative"]}}/*TWEAK-SCHEMA-END*/;`;
    expect(() => mergeTweakTokenChanges(source, source, { heading: 'Unknown' })).toThrow(
      'supported option',
    );
    expect(() => mergeTweakTokenChanges(base, base, { showNotes: 'true' })).toThrow(
      'incompatible value type',
    );
  });
});
