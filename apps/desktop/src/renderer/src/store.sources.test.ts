import type { SourceEntryResultV1 } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from './store';

const ready: SourceEntryResultV1 = {
  schemaVersion: 1,
  designId: 'html',
  workspacePath: 'C:/design',
  revision: '76741943-1171-44b6-a744-a1a3ece68fbc',
  status: 'ready',
  origin: 'declared',
  source: {
    schemaVersion: 1,
    path: 'pages/start.html',
    format: 'html',
    runtimeMode: 'native-html',
  },
  content: '<!doctype html><main>Native</main>',
};
const read = vi.fn();
const select = vi.fn();
beforeEach(() => {
  vi.stubGlobal('window', { codesign: { sourceEntry: { get: read, select } } });
  useCodesignStore.setState({
    currentDesignId: 'html',
    previewSource: null,
    previewSourceByDesign: {},
    previewIdentityByDesign: {},
    sourceEntryByDesign: {},
    recentDesignIds: [],
  });
  read.mockReset().mockResolvedValue(ready);
  select.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('renderer source identity state', () => {
  it('exports the declared primary HTML even when the visible cache contains older JSX', async () => {
    const exportFile = vi.fn(async () => ({ status: 'cancelled' }));
    Object.defineProperty(window, 'codesign', {
      configurable: true,
      value: { sourceEntry: { get: read, select }, export: exportFile },
    });
    useCodesignStore.setState({ previewSource: 'function App(){return <p>Stale</p>}' });
    await useCodesignStore.getState().exportActive('html');
    expect(exportFile).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: 'html',
        sourcePath: ready.source.path,
        artifactSource: ready.content,
      }),
    );
  });
  it('hydrates exact HTML bytes and identity into the visible preview and pool', async () => {
    await useCodesignStore.getState().refreshSourceEntry('html');
    expect(useCodesignStore.getState()).toMatchObject({
      previewSource: ready.content,
      previewIdentityByDesign: { html: ready.source },
      previewSourceByDesign: { html: ready.content },
    });
  });
  it('evicts stale preview content when the host reports an invalid entry', async () => {
    await useCodesignStore.getState().refreshSourceEntry('html');
    read.mockResolvedValue({
      schemaVersion: 1,
      designId: 'html',
      workspacePath: 'C:/design',
      revision: ready.revision,
      status: 'invalid',
      reason: 'source-missing',
      message: 'Choose a source',
    });
    await useCodesignStore.getState().refreshSourceEntry('html');
    expect(useCodesignStore.getState().previewSource).toBeNull();
    expect(useCodesignStore.getState().previewSourceByDesign['html']).toBeUndefined();
    expect(useCodesignStore.getState().previewIdentityByDesign['html']).toBeUndefined();
  });
  it('does not let an older read overwrite a completed source selection', async () => {
    await useCodesignStore.getState().refreshSourceEntry('html');
    let finish: (value: SourceEntryResultV1) => void = () => {};
    read.mockReturnValueOnce(
      new Promise<SourceEntryResultV1>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = useCodesignStore.getState().refreshSourceEntry('html');
    const selected = {
      ...ready,
      source: { ...ready.source, path: 'pages/next.html' },
      content: '<main>Selected</main>',
    };
    select.mockResolvedValue(selected);
    await useCodesignStore.getState().selectDesignSource('html', 'pages/next.html');
    finish(ready);
    await pending;
    expect(select).toHaveBeenCalledWith({
      schemaVersion: 1,
      designId: 'html',
      path: 'pages/next.html',
      expectedWorkspacePath: ready.workspacePath,
      expectedRevision: ready.revision,
    });
    expect(useCodesignStore.getState().previewIdentityByDesign['html']?.path).toBe(
      'pages/next.html',
    );
    expect(useCodesignStore.getState().previewSource).toBe(selected.content);
  });
  it('keeps another design visible when a background source lookup finishes', async () => {
    useCodesignStore.setState({ currentDesignId: 'jsx', previewSource: 'JSX source' });
    await useCodesignStore.getState().refreshSourceEntry('html');
    expect(useCodesignStore.getState().previewSource).toBe('JSX source');
    expect(useCodesignStore.getState().previewSourceByDesign['html']).toBe(ready.content);
  });
  it('does not accept a result bound to another design', async () => {
    read.mockResolvedValue({ ...ready, designId: 'other' });
    await expect(useCodesignStore.getState().refreshSourceEntry('html')).rejects.toThrow(
      'another design',
    );
    expect(useCodesignStore.getState().previewSource).toBeNull();
  });
});
