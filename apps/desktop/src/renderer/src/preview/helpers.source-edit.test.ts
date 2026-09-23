import { describe, expect, it, vi } from 'vitest';
import { handlePreviewMessage, type PreviewMessageHandlers } from './helpers';

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
});
