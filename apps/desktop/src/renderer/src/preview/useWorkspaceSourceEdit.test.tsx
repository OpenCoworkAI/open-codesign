// @vitest-environment happy-dom
import type {
  SourceEditApplyRequestV1,
  SourceEditApplyResultV1,
  SourceEditInspectResultV1,
  SourceEditTarget,
} from '@open-codesign/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceSourceEdit } from './useWorkspaceSourceEdit';

vi.mock('@open-codesign/i18n', () => ({ useT: () => translate }));
const translate = (key: string) => key;
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
const ready: SourceEditInspectResultV1 = {
  schemaVersion: 1,
  status: 'ready',
  path: 'App.jsx',
  sourceHash: hash,
  targets: [target],
};
const applied: SourceEditApplyResultV1 = {
  schemaVersion: 1,
  status: 'applied',
  path: 'App.jsx',
  content: '<p>New</p>',
  sourceHash: 'b'.repeat(64),
  scope: 'source-definition',
  patch: { start: 3, end: 6, expectedText: 'Old', replacement: 'New' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
let api: ReturnType<typeof useWorkspaceSourceEdit>;
let props: Parameters<typeof useWorkspaceSourceEdit>[0];
const inspect = vi.fn();
const apply = vi.fn();
const onPersist = vi.fn();
const onSaved = vi.fn();
function workspaceSource() {
  if (!props.source) throw new Error('Missing workspace fixture');
  return props.source;
}
function Harness() {
  api = useWorkspaceSourceEdit(props);
  return null;
}
async function render() {
  await act(async () => root.render(<Harness />));
}
async function enableAndSelect() {
  await render();
  await act(async () => api.toggle());
  const inspection = api.inspection;
  if (!inspection) throw new Error('Missing inspection');
  await act(async () =>
    api.select({
      targetId: target.id,
      sourceHash: hash,
      previewRevision: inspection.previewRevision,
    }),
  );
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  inspect.mockReset().mockResolvedValue(ready);
  apply.mockReset().mockImplementation(async (request: SourceEditApplyRequestV1) => ({
    ...applied,
    previewRevision: request.previewRevision,
  }));
  onPersist.mockReset();
  onSaved.mockReset();
  Object.defineProperty(window, 'codesign', {
    configurable: true,
    value: { sourceEdits: { inspect, apply } },
  });
  props = {
    designId: 'a',
    selectedPath: 'App.jsx',
    source: { path: 'App.jsx', content: '<p>Old</p>', workspaceDesignId: 'a' },
    available: true,
    generating: false,
    onPersist,
    onSaved,
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, 'codesign');
  vi.unstubAllGlobals();
});

describe('revision-bound local source edits', () => {
  it('is opt-in and refuses snapshot or fallback sources', async () => {
    await render();
    expect(inspect).not.toHaveBeenCalled();
    expect(api.active).toBe(false);
    props = { ...props, source: { path: 'App.jsx', content: '<p>Old</p>' } };
    await render();
    await act(async () => api.toggle());
    expect(api.eligible).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });
  it('selects exact metadata, never guesses an ancestor for unsupported clicks', async () => {
    await enableAndSelect();
    expect(api.selection?.id).toBe(target.id);
    await act(async () => api.select());
    expect(api.selection).toBeNull();
    expect(api.message).toContain('unsupportedSelection');
    await act(async () =>
      api.select({ targetId: target.id, sourceHash: hash, previewRevision: 'old' }),
    );
    expect(api.selection).toBeNull();
  });
  it('saves through apply only and refreshes from the disk ACK', async () => {
    await enableAndSelect();
    const revision = api.inspection?.previewRevision;
    await act(async () => api.apply({ kind: 'set-text', value: 'New' }));
    expect(apply).toHaveBeenCalledWith({
      schemaVersion: 1,
      designId: 'a',
      path: 'App.jsx',
      expectedSourceHash: hash,
      previewRevision: revision,
      targetId: target.id,
      operation: { kind: 'set-text', value: 'New' },
      scope: 'source-definition',
    });
    expect(onPersist).toHaveBeenCalledWith({
      path: 'App.jsx',
      content: '<p>New</p>',
      workspaceDesignId: 'a',
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(api.selection).toBeNull();
    expect(api.inspection?.previewRevision).not.toBe(revision);
  });
  it.each([
    'rejected',
    'throw',
    'wrong-path',
    'missing-revision',
    'wrong-revision',
  ] as const)('never announces saved for %s', async (outcome) => {
    await enableAndSelect();
    if (outcome === 'rejected')
      apply.mockResolvedValue({
        schemaVersion: 1,
        status: 'rejected',
        reason: 'source-conflict',
        message: 'Source changed',
      });
    else if (outcome === 'throw') apply.mockRejectedValue(new Error('Write failed'));
    else if (outcome === 'wrong-path') apply.mockResolvedValue({ ...applied, path: 'Other.jsx' });
    else if (outcome === 'missing-revision') apply.mockResolvedValue(applied);
    else apply.mockResolvedValue({ ...applied, previewRevision: 'stale' });
    await act(async () => api.apply({ kind: 'set-text', value: 'New' }));
    expect(onPersist).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.message).toBeTruthy();
  });
  it('reports a successful disk save with nonfatal notification warnings', async () => {
    await enableAndSelect();
    apply.mockImplementation(async (request: SourceEditApplyRequestV1) => ({
      ...applied,
      previewRevision: request.previewRevision,
      warnings: ['Refresh notification failed'],
    }));
    await act(async () => api.apply({ kind: 'set-text', value: 'New' }));
    expect(onPersist).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith(['Refresh notification failed']);
  });
  it.each([
    'design',
    'path',
    'content',
    'generation',
    'toggle',
  ] as const)('ignores late apply ACK after %s changes', async (change) => {
    await enableAndSelect();
    const pending = deferred<SourceEditApplyResultV1>();
    apply.mockReturnValue(pending.promise);
    let saving!: Promise<void>;
    await act(async () => {
      saving = api.apply({ kind: 'set-text', value: 'New' });
    });
    if (change === 'design') props = { ...props, designId: 'b' };
    if (change === 'path') props = { ...props, selectedPath: 'Other.jsx' };
    if (change === 'content')
      props = { ...props, source: { ...workspaceSource(), content: '<p>Changed</p>' } };
    if (change === 'generation') props = { ...props, generating: true };
    if (change === 'toggle') await act(async () => api.toggle());
    await render();
    await act(async () => {
      pending.resolve({ ...applied, previewRevision: apply.mock.calls[0]?.[0]?.previewRevision });
      await saving;
    });
    expect(onPersist).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.selection).toBeNull();
  });
  it('ignores a late inspection after changing design', async () => {
    const pending = deferred<SourceEditInspectResultV1>();
    inspect.mockReturnValue(pending.promise);
    await render();
    await act(async () => api.toggle());
    props = { ...props, designId: 'b' };
    await render();
    await act(async () => pending.resolve(ready));
    expect(api.inspection).toBeNull();
    expect(api.active).toBe(false);
  });
  it('re-inspects exact bytes after tweak block length changes', async () => {
    await enableAndSelect();
    const oldRevision = api.inspection?.previewRevision;
    props = {
      ...props,
      source: {
        ...workspaceSource(),
        content: '/* EDITMODE-BEGIN */ const x = 10000; /* EDITMODE-END */ <p>Old</p>',
      },
    };
    await render();
    expect(inspect).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedContent: props.source?.content }),
    );
    expect(api.inspection?.previewRevision).not.toBe(oldRevision);
    expect(api.selection).toBeNull();
  });
  it('keeps edit routing while a watcher rereads and reinspects the new bytes', async () => {
    await enableAndSelect();
    const revision = api.inspection?.previewRevision;
    props = { ...props, loading: true };
    await render();
    expect(api.active).toBe(true);
    expect(api.eligible).toBe(false);
    expect(api.inspection).toBeNull();
    props = {
      ...props,
      loading: false,
      source: { ...workspaceSource(), content: '<p>Longer tweak value</p>' },
    };
    await render();
    expect(api.active).toBe(true);
    expect(api.inspection?.previewRevision).not.toBe(revision);
    expect(inspect).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedContent: '<p>Longer tweak value</p>' }),
    );
  });
  it('cannot inspect or select while generation owns the workspace', async () => {
    props = { ...props, generating: true };
    await render();
    await act(async () => api.toggle());
    expect(api.active).toBe(false);
    expect(api.eligible).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });
});
