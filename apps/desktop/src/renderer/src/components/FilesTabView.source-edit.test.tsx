// @vitest-environment happy-dom
import { buildInteractivePreviewDocument } from '@open-codesign/runtime';
import type { SourceEditApplyRequestV1, SourceEditTarget } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from '../store';
import { createWorkspaceFilePreviewMessageHandlers, WorkspaceFilePreview } from './FilesTabView';

vi.mock('@open-codesign/i18n', async (original) => ({
  ...(await original<typeof import('@open-codesign/i18n')>()),
  useT: () => translate,
}));
const translate = (key: string) => key;
vi.mock('../hooks/useDesignFiles', () => ({
  useDesignFiles: () => ({ files: [] }),
  useLazyDesignFileTree: () => ({ files: [], tree: [] }),
}));
vi.mock('./TweakPanel', () => ({ TweakPanel: () => <div data-testid="tweaks" /> }));
vi.mock('@open-codesign/runtime', async (original) => ({
  ...(await original<typeof import('@open-codesign/runtime')>()),
  buildInteractivePreviewDocument: vi.fn(
    (source: string, options: { sourceEdit?: { previewRevision: string } }) =>
      `<html><body>${source}${options.sourceEdit?.previewRevision ?? ''}</body></html>`,
  ),
}));
const initial = useCodesignStore.getState();
const hash = 'a'.repeat(64);
const target: SourceEditTarget = {
  id: '1:20',
  tagName: 'p',
  start: 1,
  end: 20,
  insertionOffset: 3,
  scope: 'source-definition',
  editableFields: [{ kind: 'set-text', value: 'Old' }],
  unsupported: [],
};
const inspect = vi.fn();
const apply = vi.fn();
const read = vi.fn();
const openCommentBubble = vi.fn();
const selectCanvasElement = vi.fn();
let container: HTMLDivElement;
let root: Root;
function selection(meta?: { targetId: string; sourceHash: string; previewRevision: string }) {
  return {
    __codesign: true as const,
    type: 'ELEMENT_SELECTED' as const,
    selector: 'p',
    tag: 'p',
    outerHTML: '<p>Old</p>',
    rect: { top: 0, left: 0, width: 20, height: 20 },
    ...(meta ? { sourceEdit: meta } : {}),
  };
}
function lastRevision() {
  const calls = vi.mocked(buildInteractivePreviewDocument).mock.calls;
  const value = calls[calls.length - 1]?.[1]?.sourceEdit;
  if (!value) throw new Error('No instrumented preview');
  return value;
}
async function emit(meta?: Parameters<typeof selection>[0]) {
  const frame = container.querySelector('iframe');
  if (!frame) throw new Error('No frame');
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent('message', { source: frame.contentWindow, data: selection(meta) }),
    ),
  );
}
async function mount() {
  await act(async () => root.render(<WorkspaceFilePreview path="App.jsx" files={[]} />));
}
async function toggle() {
  const button = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
  if (!button) throw new Error('No toggle');
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  inspect.mockReset().mockResolvedValue({
    schemaVersion: 1,
    status: 'ready',
    path: 'App.jsx',
    sourceHash: hash,
    targets: [target],
  });
  apply.mockReset().mockImplementation(async (request: SourceEditApplyRequestV1) => ({
    schemaVersion: 1,
    status: 'applied',
    previewRevision: request.previewRevision,
    path: 'App.jsx',
    content: '<p>New</p>',
    sourceHash: 'b'.repeat(64),
    scope: 'source-definition',
    patch: { start: 3, end: 6, expectedText: 'Old', replacement: 'New' },
  }));
  read.mockReset().mockResolvedValue({ path: 'App.jsx', content: '<p>Old</p>' });
  openCommentBubble.mockReset();
  selectCanvasElement.mockReset();
  vi.mocked(buildInteractivePreviewDocument).mockClear();
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { files: { read }, sourceEdits: { inspect, apply }, snapshots: {} },
  });
  useCodesignStore.setState({
    currentDesignId: 'a',
    designs: [],
    previewSource: null,
    interactionMode: 'comment',
    isGenerating: false,
    generatingDesignId: null,
    comments: [],
    commentBubble: null,
    currentSnapshotId: null,
    openCommentBubble,
    selectCanvasElement,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useCodesignStore.setState(initial, true);
  Reflect.deleteProperty(window, 'codesign');
  vi.unstubAllGlobals();
});
describe('FilesTab source edit integration', () => {
  it('uses explicit source selection without instrumenting or trusting the preview', async () => {
    inspect.mockResolvedValueOnce({
      schemaVersion: 1,
      status: 'rejected',
      reason: 'unsafe-source',
      message: 'Opaque execution',
    });
    await mount();
    await toggle();
    const fallback = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'canvas.sourceEdit.chooseSource',
    );
    expect(fallback).toBeDefined();
    await act(async () => fallback?.click());
    expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ selectionMode: 'source' }));
    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    await act(async () => {
      if (!select) throw new Error('No source list');
      select.value = target.id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('textarea')?.value).toBe('Old');
    await emit({ targetId: '9:30', sourceHash: hash, previewRevision: 'forged' });
    expect(container.querySelector('textarea')?.value).toBe('Old');
    expect(
      vi.mocked(buildInteractivePreviewDocument).mock.calls.at(-1)?.[1]?.sourceEdit,
    ).toBeUndefined();
    await act(async () =>
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionMode: 'source', targetId: target.id }),
    );
  });
  it('keeps comment routing by default but never opens comments in source edit mode', async () => {
    await mount();
    await emit();
    expect(openCommentBubble).toHaveBeenCalledOnce();
    openCommentBubble.mockClear();
    selectCanvasElement.mockClear();
    await toggle();
    const revision = lastRevision();
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: revision.previewRevision,
    });
    expect(container.querySelector('textarea')?.value).toBe('Old');
    expect(openCommentBubble).not.toHaveBeenCalled();
    expect(selectCanvasElement).not.toHaveBeenCalled();
    await emit();
    expect(container.textContent).toContain('unsupportedSelection');
    expect(openCommentBubble).not.toHaveBeenCalled();
  });
  it('rejects stale revision clicks and refreshes the preview after a successful save', async () => {
    await mount();
    await toggle();
    const revision = lastRevision();
    await emit({ targetId: target.id, sourceHash: hash, previewRevision: 'old' });
    expect(container.querySelector('textarea')).toBeNull();
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: revision.previewRevision,
    });
    const form = container.querySelector('form');
    const field = form?.querySelector('textarea');
    if (!form || !field) throw new Error('Missing edit form');
    field.value = 'New';
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(apply).toHaveBeenCalledOnce();
    expect(container.querySelector('iframe')?.srcdoc).toContain('New');
    expect(lastRevision().previewRevision).not.toBe(revision.previewRevision);
    expect(container.querySelector('textarea')).toBeNull();
    expect(
      useCodesignStore.getState().toasts.some((item) => item.title === 'canvas.sourceEdit.saved'),
    ).toBe(true);
  });
  it('disables the real UI toggle during generation and clears the source panel', async () => {
    await mount();
    await toggle();
    await act(async () =>
      useCodesignStore.setState({ isGenerating: true, generatingDesignId: 'a' }),
    );
    expect(container.querySelector<HTMLButtonElement>('button[aria-pressed]')?.disabled).toBe(true);
    expect(container.querySelector('aside')).toBeNull();
  });
  it('routes unsupported selections to source editing without comment side effects', () => {
    const onSourceEditSelected = vi.fn();
    const handlers = createWorkspaceFilePreviewMessageHandlers({
      sourceEditMode: true,
      onSourceEditSelected,
      selectCanvasElement,
      openCommentBubble,
      applyLiveRects: vi.fn(),
      pushIframeError: vi.fn(),
    });
    handlers.onElementSelected(selection());
    expect(onSourceEditSelected).toHaveBeenCalledWith(undefined);
    expect(openCommentBubble).not.toHaveBeenCalled();
    expect(selectCanvasElement).not.toHaveBeenCalled();
  });
});
