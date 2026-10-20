import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import { handlePreviewFullscreenEscape } from './fullscreen';
import { handlePreviewMessage, isTrustedPreviewMessageSource } from './helpers';

describe('workspace fullscreen preview', () => {
  beforeEach(() => {
    useCodesignStore.setState({
      view: 'workspace',
      previewFullscreen: false,
      commentBubble: null,
      interactionMode: 'default',
      canvasTabs: [
        { kind: 'file', path: 'index.html' },
        { kind: 'files' },
        { kind: 'file', path: 'App.jsx' },
      ],
      activeCanvasTab: 2,
      previewZoom: 125,
      previewZoomMode: 'manual',
      previewViewport: 'desktop',
    });
  });

  it('toggles without changing source, tab, viewport or zoom preferences', () => {
    const before = useCodesignStore.getState();
    before.setPreviewFullscreen(true);
    expect(useCodesignStore.getState().previewFullscreen).toBe(true);
    handlePreviewFullscreenEscape();
    const after = useCodesignStore.getState();
    expect(after.previewFullscreen).toBe(false);
    expect(after.canvasTabs).toBe(before.canvasTabs);
    expect(after.activeCanvasTab).toBe(before.activeCanvasTab);
    expect(after.previewZoom).toBe(before.previewZoom);
    expect(after.previewZoomMode).toBe(before.previewZoomMode);
    expect(after.previewViewport).toBe(before.previewViewport);
    expect(after.previewSource).toBe(before.previewSource);
  });

  it('exits comment mode before fullscreen and ignores escapes outside fullscreen', () => {
    useCodesignStore.setState({ previewFullscreen: true, interactionMode: 'comment' });
    handlePreviewFullscreenEscape();
    expect(useCodesignStore.getState().interactionMode).toBe('default');
    expect(useCodesignStore.getState().previewFullscreen).toBe(true);
    handlePreviewFullscreenEscape();
    expect(useCodesignStore.getState().previewFullscreen).toBe(false);
    useCodesignStore.setState({ interactionMode: 'comment' });
    handlePreviewFullscreenEscape();
    expect(useCodesignStore.getState().interactionMode).toBe('comment');
  });

  it('leaves an open comment editor in charge of dismissal', () => {
    useCodesignStore.setState({
      previewFullscreen: true,
      commentBubble: {
        selector: '#counter',
        tag: 'button',
        outerHTML: '<button id="counter">2</button>',
        rect: { top: 0, left: 0, width: 80, height: 40 },
      },
    });
    handlePreviewFullscreenEscape();
    expect(useCodesignStore.getState().previewFullscreen).toBe(true);
  });

  it.each(['hub', 'settings'] as const)('resets when navigating to %s', (view) => {
    useCodesignStore.getState().setPreviewFullscreen(true);
    useCodesignStore.getState().setView(view);
    expect(useCodesignStore.getState().previewFullscreen).toBe(false);
  });

  it('resets when changing the active file but not for selecting the same tab', () => {
    useCodesignStore.getState().setPreviewFullscreen(true);
    useCodesignStore.getState().setActiveCanvasTab(2);
    expect(useCodesignStore.getState().previewFullscreen).toBe(true);
    useCodesignStore.getState().setActiveCanvasTab(1);
    expect(useCodesignStore.getState().previewFullscreen).toBe(false);
  });

  it('allows only the trusted active preview to request Escape', () => {
    const active = {} as Window;
    const foreign = {} as Window;
    const onPreviewEscape = vi.fn();
    const handlers = {
      onPreviewEscape,
      onElementSelected: vi.fn(),
      onIframeError: vi.fn(),
      onElementRects: vi.fn(),
    };
    const dispatch = (source: Window, data: unknown) => {
      if (isTrustedPreviewMessageSource(source, active)) handlePreviewMessage(data, handlers);
    };
    dispatch(foreign, { __codesign: true, type: 'PREVIEW_ESCAPE' });
    dispatch(active, { type: 'PREVIEW_ESCAPE' });
    expect(onPreviewEscape).not.toHaveBeenCalled();
    dispatch(active, { __codesign: true, type: 'PREVIEW_ESCAPE' });
    expect(onPreviewEscape).toHaveBeenCalledOnce();
  });
});
