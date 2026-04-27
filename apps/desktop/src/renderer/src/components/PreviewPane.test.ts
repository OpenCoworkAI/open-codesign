import { describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import {
  decideCodeDraftSync,
  handlePreviewMessage,
  isTrustedPreviewMessageSource,
  postModeToPreviewWindow,
  scaleRectForZoom,
  stablePreviewSourceKey,
} from './PreviewPane';

describe('isTrustedPreviewMessageSource', () => {
  it('accepts only messages from the active preview iframe window', () => {
    const previewWindow = {} as Window;
    const otherWindow = {} as Window;

    expect(isTrustedPreviewMessageSource(previewWindow, previewWindow)).toBe(true);
    expect(isTrustedPreviewMessageSource(otherWindow, previewWindow)).toBe(false);
    expect(isTrustedPreviewMessageSource(null, previewWindow)).toBe(false);
  });
});

describe('scaleRectForZoom', () => {
  const rect = { top: 100, left: 200, width: 300, height: 50 };

  it('returns identical coords at 100% zoom', () => {
    expect(scaleRectForZoom(rect, 100)).toEqual(rect);
  });

  it('halves coords and dimensions at 50% zoom', () => {
    expect(scaleRectForZoom(rect, 50)).toEqual({ top: 50, left: 100, width: 150, height: 25 });
  });

  it('doubles coords and dimensions at 200% zoom', () => {
    expect(scaleRectForZoom(rect, 200)).toEqual({ top: 200, left: 400, width: 600, height: 100 });
  });

  it('handles 75% zoom (the regression case)', () => {
    expect(scaleRectForZoom({ top: 80, left: 40, width: 100, height: 100 }, 75)).toEqual({
      top: 60,
      left: 30,
      width: 75,
      height: 75,
    });
  });
});

describe('stablePreviewSourceKey', () => {
  it('masks EDITMODE and TWEAK_SCHEMA spans for JSX artifacts', () => {
    const source = `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accent":"#000"}/*EDITMODE-END*/;
const TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{"accent":{"kind":"color"}}/*TWEAK-SCHEMA-END*/;
function App(){ return <div />; }`;

    const key = stablePreviewSourceKey(source);

    expect(key).toContain('/*EDITMODE-BEGIN*/__STABLE__/*EDITMODE-END*/');
    expect(key).toContain('/*TWEAK-SCHEMA-BEGIN*/__STABLE__/*TWEAK-SCHEMA-END*/');
    expect(key).not.toContain('{"accent":"#000"}');
  });

  it('keeps full HTML documents unstable so token changes force a reload', () => {
    const source =
      '<!doctype html><html><body><script>const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accent":"#000"}/*EDITMODE-END*/;</script></body></html>';

    expect(stablePreviewSourceKey(source)).toBe(source);
  });
});

describe('decideCodeDraftSync', () => {
  it('adopts incoming html when draft still matches previous committed html', () => {
    expect(
      decideCodeDraftSync({
        previousCommittedHtml: '<h1>old</h1>',
        nextHtml: '<h1>new</h1>',
        currentDraft: '<h1>old</h1>',
      }),
    ).toEqual({ nextDraft: '<h1>new</h1>', pendingRemoteUpdate: false });
  });

  it('keeps local draft and marks pending update when incoming html arrives while dirty', () => {
    expect(
      decideCodeDraftSync({
        previousCommittedHtml: '<h1>old</h1>',
        nextHtml: '<h1>new remote</h1>',
        currentDraft: '<h1>local edits</h1>',
      }),
    ).toEqual({ nextDraft: '<h1>local edits</h1>', pendingRemoteUpdate: true });
  });

  it('returns unchanged draft when html has not changed', () => {
    expect(
      decideCodeDraftSync({
        previousCommittedHtml: '<h1>same</h1>',
        nextHtml: '<h1>same</h1>',
        currentDraft: '<h1>local edits</h1>',
      }),
    ).toEqual({ nextDraft: '<h1>local edits</h1>', pendingRemoteUpdate: false });
  });
});

describe('handlePreviewMessage trust boundary', () => {
  function makeHandlers() {
    return {
      onElementSelected: vi.fn(),
      onIframeError: vi.fn(),
      onElementRects: vi.fn(),
      onConsoleLog: vi.fn(),
    };
  }

  it('rejects SET_MODE forged from the iframe and never mutates interactionMode', () => {
    const handlers = makeHandlers();
    useCodesignStore.setState({ interactionMode: 'default' });

    const outcome = handlePreviewMessage(
      { __codesign: true, type: 'SET_MODE', mode: 'comment' },
      handlers,
    );

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'unknown-type',
      type: 'SET_MODE',
    });
    expect(useCodesignStore.getState().interactionMode).toBe('default');
    expect(handlers.onElementSelected).not.toHaveBeenCalled();
    expect(handlers.onIframeError).not.toHaveBeenCalled();
  });

  it('rejects messages without the __codesign envelope', () => {
    const handlers = makeHandlers();
    expect(handlePreviewMessage({ type: 'ELEMENT_SELECTED' }, handlers)).toEqual({
      status: 'rejected',
      reason: 'envelope',
    });
    expect(handlePreviewMessage(null, handlers)).toEqual({
      status: 'rejected',
      reason: 'envelope',
    });
  });

  it('accepts well-formed ELEMENT_SELECTED and IFRAME_ERROR payloads', () => {
    const handlers = makeHandlers();

    const elementOutcome = handlePreviewMessage(
      {
        __codesign: true,
        type: 'ELEMENT_SELECTED',
        selector: '#root',
        tag: 'div',
        outerHTML: '<div></div>',
        rect: { top: 0, left: 0, width: 1, height: 1 },
      },
      handlers,
    );
    expect(elementOutcome).toEqual({ status: 'handled', type: 'ELEMENT_SELECTED' });
    expect(handlers.onElementSelected).toHaveBeenCalledOnce();

    const errorOutcome = handlePreviewMessage(
      {
        __codesign: true,
        type: 'IFRAME_ERROR',
        kind: 'error',
        message: 'boom',
        timestamp: 1,
      },
      handlers,
    );
    expect(errorOutcome).toEqual({ status: 'handled', type: 'IFRAME_ERROR' });
    expect(handlers.onIframeError).toHaveBeenCalledOnce();
  });

  it('accepts well-formed ELEMENT_RECTS payloads and forwards entries', () => {
    const handlers = makeHandlers();
    const outcome = handlePreviewMessage(
      {
        __codesign: true,
        type: 'ELEMENT_RECTS',
        entries: [
          { selector: '#a', rect: { top: 10, left: 20, width: 30, height: 40 } },
          { selector: '[data-codesign-id="x"]', rect: { top: 1, left: 2, width: 3, height: 4 } },
        ],
      },
      handlers,
    );
    expect(outcome).toEqual({ status: 'handled', type: 'ELEMENT_RECTS' });
    expect(handlers.onElementRects).toHaveBeenCalledOnce();
    const payload = handlers.onElementRects.mock.calls[0]?.[0] as {
      entries: Array<{ selector: string }>;
    };
    expect(payload.entries).toHaveLength(2);
    expect(payload.entries[0]?.selector).toBe('#a');
  });

  it('rejects ELEMENT_RECTS with a malformed rect entry', () => {
    const handlers = makeHandlers();
    const outcome = handlePreviewMessage(
      {
        __codesign: true,
        type: 'ELEMENT_RECTS',
        entries: [{ selector: '#bad', rect: { top: 'NaN' } }],
      },
      handlers,
    );
    expect(outcome.status).toBe('rejected');
    expect(handlers.onElementRects).not.toHaveBeenCalled();
  });

  it('rejects ELEMENT_RECTS whose entries array exceeds the hard cap', () => {
    // An LLM-controlled iframe script could try to flood liveRects. Validator
    // should drop the message before it reaches the handler.
    const handlers = makeHandlers();
    const entries = Array.from({ length: 257 }, (_, i) => ({
      selector: `#a${i}`,
      rect: { top: 0, left: 0, width: 1, height: 1 },
    }));
    const outcome = handlePreviewMessage(
      { __codesign: true, type: 'ELEMENT_RECTS', entries },
      handlers,
    );
    expect(outcome.status).toBe('rejected');
    expect(handlers.onElementRects).not.toHaveBeenCalled();
  });
});

describe('postModeToPreviewWindow', () => {
  it('forwards postMessage failures to the error sink instead of swallowing them', () => {
    const onError = vi.fn();
    const win = {
      postMessage: vi.fn(() => {
        throw new Error('iframe gone');
      }),
    } as unknown as Window;

    const ok = postModeToPreviewWindow(win, 'comment', onError);

    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toContain('iframe gone');
  });

  it('returns true and does not call onError on success', () => {
    const onError = vi.fn();
    const post = vi.fn();
    const win = { postMessage: post } as unknown as Window;

    expect(postModeToPreviewWindow(win, 'default', onError)).toBe(true);
    expect(post).toHaveBeenCalledWith({ __codesign: true, type: 'SET_MODE', mode: 'default' }, '*');
    expect(onError).not.toHaveBeenCalled();
  });

  it('returns false silently when the window handle is missing', () => {
    const onError = vi.fn();
    expect(postModeToPreviewWindow(null, 'comment', onError)).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});
