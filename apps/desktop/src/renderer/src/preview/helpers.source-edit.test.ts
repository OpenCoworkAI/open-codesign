// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handlePreviewMessage,
  type PreviewMessageHandlers,
  postSourceEditAncestorToPreviewWindow,
  postSourceEditHudStateToPreviewWindow,
  postSourceEditPreviewToPreviewWindow,
  postSourceEditRestoreToPreviewWindow,
  requestSourceEditHotSwap,
  requestSourceEditValidation,
} from './helpers';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const current = { sourceHash: 'a'.repeat(64), previewRevision: 'preview-2' };
const message = {
  __codesign: true,
  type: 'ELEMENT_SELECTED',
  selector: '/button[1]',
  tag: 'button',
  outerHTML: '<button>Save</button>',
  rect: { top: 0, left: 0, width: 10, height: 10 },
};
function handlers(): PreviewMessageHandlers {
  return { onElementSelected: vi.fn(), onElementRects: vi.fn(), onIframeError: vi.fn() };
}

describe('preview-only commit validation', () => {
  const request = { ...current, targetId: '10:50', fieldKey: 'text:only' };
  function fixture() {
    const post = vi.fn<(data: unknown, origin: string) => void>();
    const win = { postMessage: post } as unknown as Window;
    const controller = new AbortController();
    const pending = requestSourceEditValidation(win, request, {
      signal: controller.signal,
      timeoutMs: 50,
    });
    const payload = post.mock.calls[0]?.[0] as { requestId: string };
    const selected = {
      ...current,
      targetId: '10:50',
      fieldStates: [{ key: 'text:only', status: 'ready' }],
    };
    const emit = (
      sourceEdit: unknown = selected,
      source: Window = win,
      requestId = payload.requestId,
    ) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          data: { __codesign: true, type: 'SOURCE_EDIT_VALIDATED', requestId, sourceEdit },
        }),
      );
    return { post, win, controller, pending, selected, emit };
  }
  it('checks current iframe, request id, target, hash and revision before resolving', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const done = vi.fn();
    void f.pending.then(done);
    f.emit(f.selected, {} as Window);
    f.emit(f.selected, f.win, 'another-request');
    f.emit({ ...f.selected, sourceHash: 'b'.repeat(64) });
    f.emit({ ...f.selected, previewRevision: 'old' });
    f.emit({ ...f.selected, targetId: '99:100' });
    f.emit({ ...f.selected, fieldStates: [{ key: 'text:only', status: 'forged' }] });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    f.emit();
    expect(await f.pending).toEqual(f.selected);
    expect(f.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SOURCE_EDIT_VALIDATE',
        ...request,
        requestId: expect.any(String),
      }),
      '*',
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it('returns null and removes listeners on timeout or abort', async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(window, 'removeEventListener');
    const timed = fixture();
    await vi.advanceTimersByTimeAsync(51);
    expect(await timed.pending).toBeNull();
    const aborted = fixture();
    aborted.controller.abort();
    expect(await aborted.pending).toBeNull();
    expect(remove.mock.calls.filter(([type]) => type === 'message')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('accepts explicit no-mapping replies and never dispatches them as normal selections', async () => {
    const f = fixture();
    f.emit(null);
    expect(await f.pending).toBeNull();
    const callbacks = handlers();
    expect(
      handlePreviewMessage({ __codesign: true, type: 'SOURCE_EDIT_VALIDATED' }, callbacks),
    ).toEqual({ status: 'handled', type: 'SOURCE_EDIT_VALIDATED' });
    expect(callbacks.onElementSelected).not.toHaveBeenCalled();
    expect(callbacks.onIframeError).not.toHaveBeenCalled();
  });
  it('posts explicit ancestor selection with revision rather than selecting source ids', () => {
    const postMessage = vi.fn();
    const error = vi.fn();
    expect(
      postSourceEditAncestorToPreviewWindow(
        { postMessage } as unknown as Window,
        '/main[1]/button[1]',
        current,
        error,
      ),
    ).toBe(true);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      { __codesign: true, type: 'SOURCE_EDIT_SELECT', selector: '/main[1]/button[1]', ...current },
      '*',
    );
    expect(error).not.toHaveBeenCalled();
  });
  it('posts preview drafts and post-save restore selectors with current revision', () => {
    const postMessage = vi.fn();
    const win = { postMessage } as unknown as Window;
    const draft = { styles: { color: '#ff0000' }, attributes: { title: 'Updated' } };
    expect(postSourceEditPreviewToPreviewWindow(null, draft, current)).toBe(false);
    expect(postSourceEditRestoreToPreviewWindow(undefined, '/main[1]/p[1]', current)).toBe(false);
    expect(postSourceEditPreviewToPreviewWindow(win, draft, current)).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith(
      { __codesign: true, type: 'SOURCE_EDIT_PREVIEW', ...draft, ...current },
      '*',
    );
    expect(postSourceEditRestoreToPreviewWindow(win, '/main[1]/p[1]', current)).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith(
      { __codesign: true, type: 'SOURCE_EDIT_RESTORE', selector: '/main[1]/p[1]', ...current },
      '*',
    );
  });
  it('posts HUD state and extended draft fields without extra undefined keys', () => {
    const postMessage = vi.fn();
    const error = vi.fn();
    const win = { postMessage } as unknown as Window;
    expect(
      postSourceEditHudStateToPreviewWindow(null, { highlightBoxModel: true }, current, error),
    ).toBe(false);
    expect(
      postSourceEditHudStateToPreviewWindow(win, { highlightBoxModel: true }, current, error),
    ).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith(
      { __codesign: true, type: 'SOURCE_EDIT_HUD_STATE', highlightBoxModel: true, ...current },
      '*',
    );
    expect(
      postSourceEditPreviewToPreviewWindow(
        win,
        {
          styles: { color: '#111111' },
          removedStyles: ['opacity'],
          attributes: {},
          texts: { 'text:only': 'Live' },
          className: 'btn',
          hidden: true,
        },
        current,
      ),
    ).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        __codesign: true,
        type: 'SOURCE_EDIT_PREVIEW',
        styles: { color: '#111111' },
        removedStyles: ['opacity'],
        attributes: {},
        texts: { 'text:only': 'Live' },
        className: 'btn',
        hidden: true,
        ...current,
      },
      '*',
    );
  });
  it('handles hot-swap request/response lifecycle, sender checks, timeout and abort', async () => {
    vi.useFakeTimers();
    const post = vi.fn<(data: unknown, origin: string) => void>();
    const win = { postMessage: post } as unknown as Window;
    const controller = new AbortController();
    const pending = requestSourceEditHotSwap(
      win,
      {
        instrumentedSource: 'export default function App() { return <p>New</p>; }',
        sourceEditContext: { ...current, targets: {} },
        kind: 'jsx',
        restoreSelector: '/p[1]',
      },
      { signal: controller.signal, timeoutMs: 100 },
    );
    const req = post.mock.calls[0]?.[0] as { requestId: string; type: string };
    expect(req.type).toBe('SOURCE_EDIT_HOT_SWAP');
    // Reject wrong source / requestId
    window.dispatchEvent(
      new MessageEvent('message', {
        source: {} as Window,
        data: {
          __codesign: true,
          type: 'SOURCE_EDIT_HOT_SWAPPED',
          requestId: req.requestId,
          ok: true,
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: win,
        data: { __codesign: true, type: 'SOURCE_EDIT_HOT_SWAPPED', requestId: 'other', ok: true },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: win,
        data: {
          __codesign: true,
          type: 'SOURCE_EDIT_HOT_SWAPPED',
          requestId: req.requestId,
          ok: true,
        },
      }),
    );
    expect(await pending).toBe(true);

    const timedOut = requestSourceEditHotSwap(
      win,
      {
        instrumentedSource: 'const x = 1;',
        sourceEditContext: { ...current, targets: {} },
        kind: 'tsx',
      },
      { signal: new AbortController().signal, timeoutMs: 40 },
    );
    await vi.advanceTimersByTimeAsync(41);
    expect(await timedOut).toBe(false);
    expect(
      await requestSourceEditHotSwap(
        null,
        { instrumentedSource: '', sourceEditContext: { ...current, targets: {} }, kind: 'jsx' },
        { signal: new AbortController().signal },
      ),
    ).toBe(false);
  });
});

describe('source-edit preview message revisions', () => {
  it('forwards current source hints without converting them into write authorization', () => {
    const callbacks = handlers();
    const selected = { ...message, sourceEdit: { ...current, targetId: '10:50' } };
    expect(handlePreviewMessage(selected, callbacks, current)).toEqual({
      status: 'handled',
      type: 'ELEMENT_SELECTED',
    });
    expect(callbacks.onElementSelected).toHaveBeenCalledExactlyOnceWith(selected);
  });
  it.each([
    { ...current, sourceHash: 'b'.repeat(64) },
    { ...current, previewRevision: 'preview-1' },
  ])('rejects a stale document even if it uses the same WindowProxy', (stale) => {
    const callbacks = handlers();
    expect(
      handlePreviewMessage(
        { ...message, sourceEdit: { ...stale, targetId: '10:50' } },
        callbacks,
        current,
      ),
    ).toEqual({
      status: 'rejected',
      type: 'ELEMENT_SELECTED',
      reason: 'stale-source-edit',
    });
    expect(callbacks.onElementSelected).not.toHaveBeenCalled();
  });
  it('requires current top-level revision for ancestor-only selections', () => {
    const callbacks = handlers();
    const selected = {
      ...message,
      sourceEditAncestors: [{ selector: '/main[1]', tagName: 'main' }],
    };
    expect(handlePreviewMessage(selected, callbacks, current).status).toBe('rejected');
    expect(
      handlePreviewMessage(
        { ...selected, sourceEditRevision: { ...current, previewRevision: 'old' } },
        callbacks,
        current,
      ).status,
    ).toBe('rejected');
    expect(callbacks.onElementSelected).not.toHaveBeenCalled();
    expect(
      handlePreviewMessage({ ...selected, sourceEditRevision: current }, callbacks, current).status,
    ).toBe('handled');
    expect(callbacks.onElementSelected).toHaveBeenCalledOnce();
  });
  it('keeps existing no-metadata comment selection compatible', () => {
    const callbacks = handlers();
    expect(handlePreviewMessage(message, callbacks, current)).toEqual({
      status: 'handled',
      type: 'ELEMENT_SELECTED',
    });
    expect(callbacks.onElementSelected).toHaveBeenCalledExactlyOnceWith(message);
  });
  it.each([
    null,
    {},
    { ...current, targetId: '10:50', start: 10 },
    { ...current, targetId: 'x'.repeat(10000) },
    { ...current, targetId: '10:50', previewRevision: 'x'.repeat(129) },
  ])('rejects malformed or oversized source metadata before dispatch', (sourceEdit) => {
    const callbacks = handlers();
    expect(handlePreviewMessage({ ...message, sourceEdit }, callbacks, current)).toEqual({
      status: 'rejected',
      type: 'ELEMENT_SELECTED',
      reason: 'shape',
    });
    expect(callbacks.onElementSelected).not.toHaveBeenCalled();
  });
  it('validates SOURCE_EDIT_INLINE_EDIT_REQUEST, SOURCE_EDIT_HOT_SWAPPED, and multi-revision arrays', () => {
    const onInlineEditRequest = vi.fn();
    const callbacks = { ...handlers(), onInlineEditRequest };
    const inlineMsg = {
      __codesign: true as const,
      type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST' as const,
      selector: '/p[1]',
      targetId: '10:50',
      textKey: 'text:only',
      text: 'Hello',
      rect: { top: 10, left: 20, width: 100, height: 24 },
      typography: { fontSize: '16px', color: '#111111' },
      ...current,
    };
    const nextRev = { sourceHash: 'c'.repeat(64), previewRevision: 'preview-3' };
    expect(handlePreviewMessage(inlineMsg, callbacks, [current, nextRev])).toEqual({
      status: 'handled',
      type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST',
    });
    expect(onInlineEditRequest).toHaveBeenCalledExactlyOnceWith(inlineMsg);
    expect(
      handlePreviewMessage({ ...inlineMsg, previewRevision: 'stale' }, callbacks, [
        current,
        nextRev,
      ]),
    ).toEqual({
      status: 'rejected',
      type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST',
      reason: 'stale-source-edit',
    });
    expect(
      handlePreviewMessage({ ...inlineMsg, typography: { badKey: '1' } }, callbacks, current),
    ).toEqual({
      status: 'rejected',
      type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST',
      reason: 'shape',
    });
    expect(
      handlePreviewMessage(
        { __codesign: true, type: 'SOURCE_EDIT_HOT_SWAPPED', requestId: 'req-1', ok: true },
        callbacks,
      ),
    ).toEqual({ status: 'handled', type: 'SOURCE_EDIT_HOT_SWAPPED' });
    expect(
      handlePreviewMessage(
        { __codesign: true, type: 'SOURCE_EDIT_HOT_SWAPPED', requestId: 'req-1', ok: 'yes' },
        callbacks,
      ),
    ).toEqual({ status: 'rejected', type: 'SOURCE_EDIT_HOT_SWAPPED', reason: 'shape' });
  });
});
