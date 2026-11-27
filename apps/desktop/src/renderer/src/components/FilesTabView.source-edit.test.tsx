// @vitest-environment happy-dom
import { buildInteractivePreviewDocument } from '@open-codesign/runtime';
import type { SourceEditApplyRequestV1, SourceEditTarget } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignFileEntry } from '../hooks/useDesignFiles';
import {
  postSourceEditRestoreToPreviewWindow,
  requestSourceEditHotSwap,
  requestSourceEditValidation,
} from '../preview/helpers';
import type { WorkspacePreviewReadResult } from '../preview/workspace-source';
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
  prepareInteractivePreviewHotSwap: vi.fn(
    (source: string, sourceEdit: { sourceHash: string; previewRevision: string }) => ({
      instrumentedSource: source,
      context: {
        sourceHash: sourceEdit.sourceHash,
        previewRevision: sourceEdit.previewRevision,
        targets: {},
      },
    }),
  ),
}));
vi.mock('../preview/helpers', async (original) => {
  const actual = await original<typeof import('../preview/helpers')>();
  return {
    ...actual,
    requestSourceEditValidation: vi.fn(),
    requestSourceEditHotSwap: vi.fn(async () => false),
    postSourceEditRestoreToPreviewWindow: vi.fn(actual.postSourceEditRestoreToPreviewWindow),
  };
});
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
const undo = vi.fn();
const redo = vi.fn();
const read = vi.fn();
const write = vi.fn();
const changeListeners = new Set<(event: { schemaVersion: 1; designId: string }) => void>();
const onChanged = vi.fn((listener: (event: { schemaVersion: 1; designId: string }) => void) => {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
});
const subscribe = vi.fn();
const unsubscribe = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function changeFiles(designId: string) {
  await act(async () => {
    for (const listener of changeListeners) listener({ schemaVersion: 1, designId });
  });
}
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
async function mount(path = 'App.jsx', files: DesignFileEntry[] = []) {
  await act(async () => root.render(<WorkspaceFilePreview path={path} files={files} />));
}
function tab(name: 'page' | 'element') {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(
      (button) => button.textContent === `inspector.tabs.${name}`,
    ) ?? null
  );
}
function elementTab() {
  const button = tab('element');
  if (!button) throw new Error('No element tab');
  return button;
}
function elementModeOn() {
  return tab('element')?.getAttribute('aria-selected') === 'true';
}
/** Switches the inspector rail between Page and Element (source edit) mode. */
async function toggle() {
  const button = elementModeOn() ? tab('page') : elementTab();
  if (!button) throw new Error('No toggle');
  await act(async () => button.click());
}
function buttonByText(text: string) {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === text,
    ) ?? null
  );
}
async function typeInto(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function clickApply() {
  const button = buttonByText('inspector.element.apply');
  if (!button) throw new Error('No apply button');
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  inspect.mockReset().mockImplementation(async ({ path }: { path: string }) => ({
    schemaVersion: 1,
    status: 'ready',
    path,
    sourceHash: hash,
    targets: [target],
  }));
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
  write.mockReset().mockResolvedValue({ path: 'DESIGN.md' });
  undo.mockReset().mockImplementation(async (request: { previewRevision: string }) => ({
    schemaVersion: 1 as const,
    status: 'applied' as const,
    previewRevision: request.previewRevision,
    path: 'App.jsx',
    content: '<p>Old</p>',
    sourceHash: hash,
    scope: 'source-definition' as const,
    canUndo: false,
    canRedo: true,
    patch: { start: 3, end: 6, expectedText: 'New', replacement: 'Old' },
  }));
  redo.mockReset().mockImplementation(async (request: { previewRevision: string }) => ({
    schemaVersion: 1 as const,
    status: 'applied' as const,
    previewRevision: request.previewRevision,
    path: 'App.jsx',
    content: '<p>New</p>',
    sourceHash: 'b'.repeat(64),
    scope: 'source-definition' as const,
    canUndo: true,
    canRedo: false,
    patch: { start: 3, end: 6, expectedText: 'Old', replacement: 'New' },
  }));
  changeListeners.clear();
  onChanged.mockClear();
  subscribe.mockReset();
  unsubscribe.mockReset();
  openCommentBubble.mockReset();
  selectCanvasElement.mockReset();
  vi.mocked(buildInteractivePreviewDocument).mockClear();
  vi.mocked(postSourceEditRestoreToPreviewWindow).mockClear();
  vi.mocked(requestSourceEditHotSwap).mockReset().mockResolvedValue(false);
  vi.mocked(requestSourceEditValidation)
    .mockReset()
    .mockImplementation(async (_win, request) => ({
      targetId: request.targetId,
      sourceHash: request.sourceHash,
      previewRevision: request.previewRevision,
      fieldStates: [{ key: request.fieldKey, status: 'ready' }],
    }));
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: {
      files: { read, write, onChanged, subscribe, unsubscribe },
      sourceEdits: { inspect, apply, undo, redo },
      snapshots: {},
    },
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
  it.each([
    'App.jsx',
    'Screen.jsx',
    'Screen.tsx',
  ])('inspects the resolved sibling %s for a nested HTML selection', async (sourceName) => {
    const sourcePath = `pages/${sourceName}`;
    read.mockImplementation(async (_designId: string, path: string) => ({
      path,
      content:
        path === 'pages/preview.html'
          ? `<!doctype html><!-- artifact source lives in ${sourceName} -->`
          : '<p>Old</p>',
    }));
    await mount('pages/preview.html');
    expect(read).toHaveBeenCalledWith('a', sourcePath);
    expect(container.querySelector('iframe')?.srcdoc).toContain('<p>Old</p>');
    await toggle();
    expect(inspect).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      designId: 'a',
      path: sourcePath,
      expectedContent: '<p>Old</p>',
    });
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: lastRevision().previewRevision,
    });
    expect(container.querySelector('textarea')?.value).toBe('Old');
  });

  it('does not reuse a previous file while another read is pending or accept its delayed result', async () => {
    const pending = deferred<WorkspacePreviewReadResult>();
    read.mockImplementation(async (_designId: string, path: string) => {
      if (path === 'second.html') return pending.promise;
      return { path, content: path === 'third.jsx' ? '<p>Third</p>' : '<p>Old</p>' };
    });
    await mount();
    await toggle();
    const oldRevision = lastRevision();
    await mount('second.html');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    await mount('third.jsx');
    await toggle();
    expect(inspect).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'third.jsx' }));
    await act(async () => pending.resolve({ path: 'App.jsx', content: '<p>Delayed</p>' }));
    expect(container.querySelector('iframe')?.srcdoc).toContain('Third');
    expect(container.querySelector('iframe')?.srcdoc).not.toContain('Delayed');
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: oldRevision.previewRevision,
    });
    expect(container.querySelector('textarea')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('does not show or inspect another design source during delayed same-path switches', async () => {
    const pending = deferred<WorkspacePreviewReadResult>();
    read.mockImplementation(async (designId: string, path: string) => {
      if (designId === 'b') return pending.promise;
      return { path, content: designId === 'c' ? '<p>Current</p>' : '<p>Old</p>' };
    });
    await mount();
    await toggle();
    const oldRevision = lastRevision();
    await act(async () => useCodesignStore.setState({ currentDesignId: 'b' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(inspect).not.toHaveBeenCalledWith(expect.objectContaining({ designId: 'b' }));
    await act(async () => useCodesignStore.setState({ currentDesignId: 'c' }));
    await toggle();
    expect(inspect).toHaveBeenLastCalledWith(
      expect.objectContaining({ designId: 'c', expectedContent: '<p>Current</p>' }),
    );
    await act(async () => pending.resolve({ path: 'App.jsx', content: '<p>Delayed</p>' }));
    expect(container.querySelector('iframe')?.srcdoc).toContain('Current');
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: oldRevision.previewRevision,
    });
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('invalidates a loaded source when the same design changes workspace', async () => {
    const design = {
      schemaVersion: 1 as const,
      id: 'a',
      name: 'Preview fixture',
      createdAt: '2026-09-17',
      updatedAt: '2026-09-17',
      thumbnailText: null,
      deletedAt: null,
      workspacePath: '/workspace/old',
    };
    useCodesignStore.setState({ designs: [design] });
    await mount();
    await toggle();
    const pending = deferred<WorkspacePreviewReadResult>();
    read.mockReturnValueOnce(pending.promise);
    await act(async () =>
      useCodesignStore.setState({ designs: [{ ...design, workspacePath: '/workspace/new' }] }),
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    await act(async () => pending.resolve({ path: 'App.jsx', content: '<p>New workspace</p>' }));
    expect(container.querySelector('iframe')?.srcdoc).toContain('New workspace');
    await toggle();
    expect(inspect).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedContent: '<p>New workspace</p>' }),
    );
  });

  it('refreshes unlisted nested sources on current-design changes and rejects stale selections', async () => {
    const files: DesignFileEntry[] = [
      { path: 'index.html', kind: 'html', updatedAt: 'unchanged', size: 70, source: 'workspace' },
    ];
    const pending = deferred<WorkspacePreviewReadResult>();
    let changed = false;
    read.mockImplementation(async (_designId: string, path: string) => {
      if (path === 'index.html') {
        return { path, content: '<!doctype html><!-- artifact source lives in src/App.jsx -->' };
      }
      return changed ? pending.promise : { path, content: '<p>Old</p>' };
    });
    await mount('index.html', files);
    await toggle();
    const oldRevision = lastRevision();
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: oldRevision.previewRevision,
    });
    expect(container.querySelector('textarea')?.value).toBe('Old');
    const readsBeforeChange = read.mock.calls.length;
    await changeFiles('other-design');
    expect(read).toHaveBeenCalledTimes(readsBeforeChange);
    changed = true;
    await changeFiles('a');
    expect(read).toHaveBeenCalledTimes(readsBeforeChange + 2);
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    expect(tab('element')?.disabled).toBe(true);
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: oldRevision.previewRevision,
    });
    expect(container.querySelector('textarea')?.disabled).toBe(true);
    inspect.mockResolvedValueOnce({
      schemaVersion: 1,
      status: 'ready',
      path: 'src/App.jsx',
      sourceHash: 'b'.repeat(64),
      targets: [{ ...target, editableFields: [{ kind: 'set-text', value: 'External' }] }],
    });
    await act(async () => pending.resolve({ path: 'src/App.jsx', content: '<p>External</p>' }));
    expect(inspect).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: 'src/App.jsx', expectedContent: '<p>External</p>' }),
    );
    expect(container.querySelector('iframe')?.srcdoc).toContain('External');
    const revision = lastRevision();
    expect(revision.previewRevision).not.toBe(oldRevision.previewRevision);
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: revision.previewRevision,
    });
    expect(container.querySelector('textarea')).toBeNull();
    await emit({
      targetId: target.id,
      sourceHash: 'b'.repeat(64),
      previewRevision: oldRevision.previewRevision,
    });
    expect(container.querySelector('textarea')).toBeNull();
    await emit({
      targetId: target.id,
      sourceHash: 'b'.repeat(64),
      previewRevision: revision.previewRevision,
    });
    expect(container.querySelector('textarea')?.value).toBe('External');
    expect(apply).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(changeListeners.size).toBe(1);
    // Once the directory is loaded, file metadata owns invalidation again.
    await mount('index.html', [
      ...files,
      { path: 'src/App.jsx', kind: 'jsx', updatedAt: 'new', source: 'workspace' },
    ]);
    expect(changeListeners.size).toBe(0);
  });
  it('shows inspection refusal without a source-picker bypass', async () => {
    inspect.mockResolvedValueOnce({
      schemaVersion: 1,
      status: 'rejected',
      reason: 'unsafe-source',
      message: 'Opaque execution',
    });
    await mount();
    await toggle();
    expect(container.textContent).toContain('canvas.sourceEdit.reasons.unknown');
    expect(container.textContent).not.toContain('Opaque execution');
    expect(container.textContent).not.toContain('canvas.sourceEdit.chooseSource');
    expect(container.querySelector('aside select')).toBeNull();
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect.mock.calls[0]?.[0]).not.toHaveProperty('selectionMode');
    expect(apply).not.toHaveBeenCalled();
  });
  it('navigates unmapped-node ancestors with an explicit current-preview request', async () => {
    await mount();
    await toggle();
    const frame = container.querySelector('iframe');
    if (!frame?.contentWindow) throw new Error('no frame');
    const post = vi.spyOn(frame.contentWindow, 'postMessage');
    await act(async () => frame.dispatchEvent(new Event('load')));
    expect(post).toHaveBeenCalledWith(
      { __codesign: true, type: 'SET_MODE', mode: 'source-edit' },
      '*',
    );
    const revision = lastRevision();
    const data = {
      ...selection(),
      sourceEditRevision: {
        sourceHash: revision.sourceHash,
        previewRevision: revision.previewRevision,
      },
      sourceEditAncestors: [{ selector: '/main[1]/button[1]', tagName: 'button' }],
    };
    await act(async () =>
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data })),
    );
    const crumb = container.querySelector<HTMLButtonElement>(
      'button[title="inspector.element.selectParent"]',
    );
    expect(crumb).not.toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    await act(async () => crumb?.click());
    expect(post).toHaveBeenCalledWith(
      {
        __codesign: true,
        type: 'SOURCE_EDIT_SELECT',
        selector: '/main[1]/button[1]',
        sourceHash: revision.sourceHash,
        previewRevision: revision.previewRevision,
      },
      '*',
    );
    expect(container.querySelector('textarea')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(openCommentBubble).not.toHaveBeenCalled();
  });
  it('does not save when the iframe cannot revalidate the current field', async () => {
    await mount();
    await toggle();
    const revision = lastRevision();
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: revision.previewRevision,
    });
    const field = container.querySelector('textarea');
    if (!field) throw new Error('Missing text field');
    await typeInto(field, 'New');
    vi.mocked(requestSourceEditValidation).mockResolvedValue(null);
    await clickApply();
    expect(requestSourceEditValidation).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(container.textContent).toContain('canvas.sourceEdit.validationFailed');
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
    const field = container.querySelector('textarea');
    if (!field) throw new Error('Missing text field');
    await typeInto(field, 'New');
    expect(container.textContent).toContain('inspector.element.pending');
    await clickApply();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0]?.[0]).toMatchObject({
      operation: { kind: 'set-text', value: 'New' },
    });
    expect(container.querySelector('iframe')?.srcdoc).toContain('New');
    const nextRevision = lastRevision();
    expect(nextRevision.previewRevision).not.toBe(revision.previewRevision);
    expect(container.querySelector('textarea')).toBeNull();
    expect(elementModeOn()).toBe(true);
    expect(
      useCodesignStore.getState().toasts.some((item) => item.title === 'canvas.sourceEdit.saved'),
    ).toBe(true);
    // The refreshed preview asks the overlay to reselect the element that was just saved.
    const frame = container.querySelector('iframe');
    if (!frame?.contentWindow) throw new Error('no frame');
    if (vi.mocked(postSourceEditRestoreToPreviewWindow).mock.calls.length === 0) {
      await act(async () => frame.dispatchEvent(new Event('load')));
    }
    expect(postSourceEditRestoreToPreviewWindow).toHaveBeenCalledTimes(1);
    expect(postSourceEditRestoreToPreviewWindow).toHaveBeenCalledWith(
      frame.contentWindow,
      'p',
      expect.objectContaining({
        sourceHash: nextRevision.sourceHash,
        previewRevision: nextRevision.previewRevision,
      }),
    );
    vi.mocked(postSourceEditRestoreToPreviewWindow).mockClear();
    await act(async () => frame.dispatchEvent(new Event('load')));
    expect(postSourceEditRestoreToPreviewWindow).not.toHaveBeenCalled();
  });
  it('exits edit mode on iframe Escape without changing the stored comment interaction mode', async () => {
    await mount();
    await toggle();
    const frame = container.querySelector('iframe');
    if (!frame) throw new Error('no frame');
    expect(elementModeOn()).toBe(true);
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { __codesign: true, type: 'PREVIEW_ESCAPE' },
        }),
      ),
    );
    expect(elementModeOn()).toBe(false);
    expect(tab('page')?.getAttribute('aria-selected')).toBe('true');
    expect(useCodesignStore.getState().interactionMode).toBe('comment');
    expect(apply).not.toHaveBeenCalled();
    expect(openCommentBubble).not.toHaveBeenCalled();
  });
  it('exits on toolbar-focused Escape after preview selection while ignoring IME and unrelated focus', async () => {
    await mount();
    const toolbar = elementTab();
    toolbar.focus();
    await act(async () => toolbar.click());
    const revision = lastRevision();
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: revision.previewRevision,
    });
    expect(document.activeElement).toBe(toolbar);
    expect(container.querySelector('textarea')).not.toBeNull();
    const unrelated = document.createElement('button');
    document.body.append(unrelated);
    await act(async () =>
      unrelated.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(toolbar.getAttribute('aria-selected')).toBe('true');
    unrelated.remove();
    await act(async () =>
      toolbar.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(toolbar.getAttribute('aria-selected')).toBe('true');
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => toolbar.dispatchEvent(escapeEvent));
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(toolbar.getAttribute('aria-selected')).toBe('false');
    expect(elementModeOn()).toBe(false);
    expect(tab('page')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('textarea')).toBeNull();
    expect(useCodesignStore.getState().interactionMode).toBe('comment');
    expect(apply).not.toHaveBeenCalled();
    const ordinaryEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => toolbar.dispatchEvent(ordinaryEscape));
    expect(ordinaryEscape.defaultPrevented).toBe(false);
  });
  it('disables the real UI toggle during generation and clears the source panel', async () => {
    await mount();
    await toggle();
    await act(async () =>
      useCodesignStore.setState({ isGenerating: true, generatingDesignId: 'a' }),
    );
    expect(tab('element')?.disabled).toBe(true);
    expect(elementModeOn()).toBe(false);
    expect(container.querySelector('textarea')).toBeNull();
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
    expect(onSourceEditSelected).toHaveBeenCalledWith(undefined, [], {
      selector: 'p',
      tag: 'p',
      outerHTML: '<p>Old</p>',
      rect: { top: 0, left: 0, width: 20, height: 20 },
    });
    expect(openCommentBubble).not.toHaveBeenCalled();
    expect(selectCanvasElement).not.toHaveBeenCalled();
  });

  it('preserves the iframe DOM node and srcDoc across a successful hot-swap save', async () => {
    vi.mocked(requestSourceEditHotSwap).mockResolvedValue(true);
    await mount();
    await toggle();
    const frameBefore = container.querySelector('iframe');
    const srcDocBefore = frameBefore?.srcdoc;
    const revision = lastRevision();
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: revision.previewRevision,
    });
    const field = container.querySelector('textarea');
    if (!field) throw new Error('Missing text field');
    await typeInto(field, 'New');
    inspect.mockResolvedValueOnce({
      schemaVersion: 1,
      status: 'ready',
      path: 'App.jsx',
      sourceHash: 'b'.repeat(64),
      targets: [{ ...target, editableFields: [{ kind: 'set-text', value: 'New' }] }],
    });
    const callsBeforeSave = vi.mocked(buildInteractivePreviewDocument).mock.calls.length;
    await clickApply();
    expect(requestSourceEditHotSwap).toHaveBeenCalledOnce();
    const frameAfter = container.querySelector('iframe');
    expect(frameAfter).toBe(frameBefore);
    expect(frameAfter?.srcdoc).toBe(srcDocBefore);
    expect(vi.mocked(buildInteractivePreviewDocument)).toHaveBeenCalledTimes(callsBeforeSave);
    expect(postSourceEditRestoreToPreviewWindow).not.toHaveBeenCalled();
  });

  it('supports editing standalone .html files cleanly', async () => {
    read.mockResolvedValue({ path: 'landing.html', content: '<p>Old</p>' });
    inspect.mockResolvedValue({
      schemaVersion: 1,
      status: 'ready',
      path: 'landing.html',
      sourceHash: hash,
      targets: [target],
    });
    await mount('landing.html');
    await toggle();
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ path: 'landing.html' }));
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: lastRevision().previewRevision,
    });
    expect(container.querySelector('textarea')?.value).toBe('Old');
  });

  it('renders CanvasFloatingToolbar & InlineTextOverlay and commits quick actions / inline text', async () => {
    const richTarget: SourceEditTarget = {
      ...target,
      capabilities: {
        canUpsertStyle: true,
        canUpsertAttribute: true,
        canEditClassName: true,
        canReorderUp: true,
        canReorderDown: true,
        canDuplicate: true,
        canDelete: true,
        sharedDefinition: false,
        styleMode: 'inline',
      },
    };
    inspect.mockResolvedValue({
      schemaVersion: 1,
      status: 'ready',
      path: 'App.jsx',
      sourceHash: hash,
      targets: [richTarget],
    });
    await mount();
    await toggle();
    const revision = lastRevision();
    await emit({
      targetId: richTarget.id,
      sourceHash: hash,
      previewRevision: revision.previewRevision,
    });
    const duplicateBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="inspector.element.duplicate"]',
    );
    expect(duplicateBtn).not.toBeNull();
    await act(async () => duplicateBtn?.click());
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ operation: { kind: 'duplicate-element' } }),
    );
    const frame = container.querySelector('iframe');
    if (!frame) throw new Error('No iframe');
    const nextRev = lastRevision();
    await emit({
      targetId: richTarget.id,
      sourceHash: nextRev.sourceHash,
      previewRevision: nextRev.previewRevision,
    });
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: {
            __codesign: true,
            type: 'SOURCE_EDIT_INLINE_EDIT_REQUEST',
            selector: 'p',
            targetId: richTarget.id,
            textKey: 'text:only',
            text: 'Old',
            rect: { top: 10, left: 20, width: 80, height: 24 },
            typography: { fontSize: '16px' },
            sourceHash: nextRev.sourceHash,
            previewRevision: nextRev.previewRevision,
          },
        }),
      ),
    );
    const inlineInput = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="inspector.element.inlineEditorLabel"]',
    );
    expect(inlineInput).not.toBeNull();
    if (!inlineInput) return;
    await typeInto(inlineInput, 'InlineUpdated');
    await act(async () => {
      inlineInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ operation: { kind: 'set-text', value: 'InlineUpdated' } }),
    );
  });

  it('triggers undo and redo on Cmd/Ctrl+Z shortcuts while ignoring form inputs', async () => {
    inspect.mockResolvedValue({
      schemaVersion: 1,
      status: 'ready',
      path: 'App.jsx',
      sourceHash: hash,
      canUndo: true,
      canRedo: true,
      targets: [target],
    });
    await mount();
    await toggle();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(undo).not.toHaveBeenCalled();
    input.remove();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(undo).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(redo).toHaveBeenCalledOnce();
  });

  it('syncs the page color palette into DESIGN.md when requested from PageColorsSection', async () => {
    read.mockImplementation(async (_designId: string, path: string) => {
      if (path === 'DESIGN.md') {
        return {
          path: 'DESIGN.md',
          content:
            '---\nname: Brand\ncolors:\n  primary: "#112233"\n---\n\n## Overview\n\nKeep me.\n',
        };
      }
      return { path, content: '<div style={{ color: "#abcdef" }}>Hello</div>' };
    });
    await mount();
    const syncButton = container.querySelector<HTMLButtonElement>(
      'button[title="inspector.page.syncDesignMd"]',
    );
    expect(syncButton).not.toBeNull();
    await act(async () => syncButton?.click());
    expect(write).toHaveBeenCalledWith(
      'a',
      'DESIGN.md',
      expect.stringContaining('#abcdef'),
      expect.objectContaining({ expectedContent: expect.stringContaining('Keep me.') }),
    );
    expect(write.mock.calls[0]?.[2]).toContain('#112233');
    expect(write.mock.calls[0]?.[2]).toContain('Keep me.');
  });

  it('builds structured AST handoff context before exiting on Ask AI', async () => {
    const richContent =
      'export function Hero() {\n  return <p style={{ color: "#111" }}>Old</p>;\n}';
    const startOffset = richContent.indexOf('<p');
    const endOffset = richContent.indexOf('</p>') + '</p>'.length;
    read.mockResolvedValue({ path: 'App.jsx', content: richContent });
    const astTarget: SourceEditTarget = {
      ...target,
      start: startOffset,
      end: endOffset,
      sourceLocation: { startLine: 2, startCol: 10, endLine: 2, endCol: 49 },
      textLayout: [{ kind: 'text', value: 'Old' }],
      capabilities: {
        canUpsertStyle: true,
        canUpsertAttribute: true,
        canEditClassName: true,
        canReorderUp: false,
        canReorderDown: false,
        canDuplicate: false,
        canDelete: false,
        sharedDefinition: false,
        enclosingComponent: 'Hero',
        styleMode: 'inline',
      },
    };
    inspect.mockResolvedValue({
      schemaVersion: 1,
      status: 'ready',
      path: 'App.jsx',
      sourceHash: hash,
      targets: [astTarget],
    });
    await mount();
    await toggle();
    const frame = container.querySelector('iframe');
    if (!frame) throw new Error('No iframe');
    const revision = lastRevision();
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: {
            ...selection({
              targetId: astTarget.id,
              sourceHash: hash,
              previewRevision: revision.previewRevision,
            }),
            parentOuterHTML: '<section><p>Old</p></section>',
            elementSnapshot: {
              computedStyle: { color: 'rgb(17, 17, 17)', padding: '8px' },
              boxModel: {
                width: 100,
                height: 20,
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                border: { top: 0, right: 0, bottom: 0, left: 0 },
              },
              instanceCount: 1,
            },
          },
        }),
      ),
    );
    const askAiBtn = buttonByText('inspector.element.askAi');
    expect(askAiBtn).not.toBeNull();
    await act(async () => askAiBtn?.click());
    expect(elementModeOn()).toBe(false);
    expect(openCommentBubble).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: 'App.jsx',
        parentOuterHTML: '<section><p>Old</p></section>',
        astContext: expect.objectContaining({
          startLine: 2,
          startCol: 10,
          enclosingComponent: 'Hero',
          sourceExcerpt: '<p style={{ color: "#111" }}>Old</p>',
          computedStyles: { color: 'rgb(17, 17, 17)', padding: '8px' },
        }),
      }),
    );
  });
});
