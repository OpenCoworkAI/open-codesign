import { expect, it, vi } from 'vitest';
import type { CodesignApi } from './index';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: CodesignApi) => void>(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: electron,
}));
import './index';
it('exposes deterministic inspect/apply without invoking generation or file overwrite APIs', async () => {
  const api = electron.exposeInMainWorld.mock.calls[0]?.[1];
  if (!api) throw new Error('Missing exposed preload API');
  const inspect = {
    schemaVersion: 1 as const,
    designId: 'design',
    path: 'App.jsx',
    expectedContent: 'source',
  };
  await api.sourceEdits.inspect(inspect);
  expect(electron.invoke).toHaveBeenLastCalledWith('codesign:source-edits:v1:inspect', inspect);
  const apply = {
    schemaVersion: 1 as const,
    designId: 'design',
    path: 'App.jsx',
    expectedSourceHash: 'a'.repeat(64),
    previewRevision: 'preview-1',
    targetId: '0:10',
    operation: { kind: 'set-text' as const, value: 'Next' },
    scope: 'source-definition' as const,
  };
  await api.sourceEdits.apply(apply);
  expect(electron.invoke).toHaveBeenLastCalledWith('codesign:source-edits:v1:apply', apply);
  expect(electron.invoke).toHaveBeenCalledTimes(2);
});
