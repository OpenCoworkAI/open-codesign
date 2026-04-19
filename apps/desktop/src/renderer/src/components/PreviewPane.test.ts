import { describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import {
  handlePreviewMessage,
  isTrustedPreviewMessageSource,
  postModeToPreviewWindow,
  scaleRectForZoom,
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

describe('handlePreviewMessage trust boundary', () => {
  function makeHandlers() {
    return {
      onElementSelected: vi.fn(),
      onIframeError: vi.fn(),
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
