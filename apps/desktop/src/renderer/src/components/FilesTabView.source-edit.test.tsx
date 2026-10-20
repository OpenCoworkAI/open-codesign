// @vitest-environment happy-dom
import { buildInteractivePreviewDocument } from '@open-codesign/runtime';
import type { SourceEditApplyRequestV1, SourceEditTarget } from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignFileEntry } from '../hooks/useDesignFiles';
import { requestSourceEditValidation } from '../preview/helpers';
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
}));
vi.mock('../preview/helpers', async (original) => ({
  ...(await original<typeof import('../preview/helpers')>()),
  requestSourceEditValidation: vi.fn(),
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
async function toggle() {
  const button = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
  if (!button) throw new Error('No toggle');
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
  changeListeners.clear();
  onChanged.mockClear();
  subscribe.mockReset();
  unsubscribe.mockReset();
  openCommentBubble.mockReset();
  selectCanvasElement.mockReset();
  vi.mocked(buildInteractivePreviewDocument).mockClear();
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
      files: { read, onChanged, subscribe, unsubscribe },
      sourceEdits: { inspect, apply },
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
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('button[aria-pressed]')?.disabled).toBe(true);
    await emit({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: oldRevision.previewRevision,
    });
    expect(container.querySelector('textarea')).toBeNull();
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
      'nav[aria-label="canvas.sourceEdit.ancestors"] button',
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
    vi.mocked(requestSourceEditValidation).mockResolvedValue(null);
    await act(async () =>
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
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
  it('exits edit mode on iframe Escape without changing the stored comment interaction mode', async () => {
    await mount();
    await toggle();
    const frame = container.querySelector('iframe');
    if (!frame) throw new Error('no frame');
    expect(container.querySelector('aside')).not.toBeNull();
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { __codesign: true, type: 'PREVIEW_ESCAPE' },
        }),
      ),
    );
    expect(container.querySelector('aside')).toBeNull();
    expect(container.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(useCodesignStore.getState().interactionMode).toBe('comment');
    expect(apply).not.toHaveBeenCalled();
    expect(openCommentBubble).not.toHaveBeenCalled();
  });
  it('exits on toolbar-focused Escape after preview selection while ignoring IME and unrelated focus', async () => {
    await mount();
    const toolbar = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    if (!toolbar) throw new Error('No edit toolbar');
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
    expect(toolbar.getAttribute('aria-pressed')).toBe('true');
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
    expect(toolbar.getAttribute('aria-pressed')).toBe('true');
    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => toolbar.dispatchEvent(escapeEvent));
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(toolbar.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('aside')).toBeNull();
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
    expect(onSourceEditSelected).toHaveBeenCalledWith(undefined, []);
    expect(openCommentBubble).not.toHaveBeenCalled();
    expect(selectCanvasElement).not.toHaveBeenCalled();
  });
});
