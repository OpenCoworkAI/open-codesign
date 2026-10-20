// @vitest-environment happy-dom

import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceDirectoryEntry } from '../../../preload/index';
import { useCodesignStore } from '../store';
import { useLazyDesignFileTree } from './useDesignFiles';

const initial = useCodesignStore.getState();
let container: HTMLDivElement;
let root: Root;
const observed: string[][] = [];
function Listing({ designId }: { designId: string }) {
  const { files, tree } = useLazyDesignFileTree(designId);
  useLayoutEffect(() => {
    observed.push(files.map((file) => file.path));
  });
  return <pre>{JSON.stringify({ files, tree })}</pre>;
}
function file(path: string): WorkspaceDirectoryEntry {
  return { path, name: path, type: 'file', kind: path.endsWith('.html') ? 'html' : 'jsx' };
}
function design(id: string, workspacePath: string) {
  return {
    schemaVersion: 1 as const,
    id,
    name: id,
    workspacePath,
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    thumbnailText: null,
    deletedAt: null,
  };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useCodesignStore.setState({
    ...initial,
    designs: [design('html', '/html')],
    previewSource: null,
  });
  observed.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useCodesignStore.setState(initial);
  vi.unstubAllGlobals();
});

it.each([
  'switch design',
  'rebind workspace',
])('%s never exposes the previous workspace tree while the next list is pending', async (scenario) => {
  let finish!: (entries: WorkspaceDirectoryEntry[]) => void;
  const pending = new Promise<WorkspaceDirectoryEntry[]>((resolve) => {
    finish = resolve;
  });
  const listDir = vi
    .fn()
    .mockResolvedValueOnce([file('index.html')])
    .mockReturnValue(pending);
  Object.defineProperty(window, 'codesign', { configurable: true, value: { files: { listDir } } });
  await act(async () => root.render(<Listing designId="html" />));
  expect(observed.at(-1)).toEqual(['index.html']);
  observed.length = 0;
  const nextId = scenario === 'switch design' ? 'react' : 'html';
  await act(async () => {
    useCodesignStore.setState({ designs: [design(nextId, '/react')] });
    root.render(<Listing designId={nextId} />);
  });
  expect(listDir).toHaveBeenLastCalledWith(nextId, '.');
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((paths) => paths.length === 0)).toBe(true);
  expect(container.textContent).not.toContain('index.html');
  await act(async () => finish([file('App.jsx')]));
  expect(observed.at(-1)).toEqual(['App.jsx']);
  expect(container.textContent).toContain('App.jsx');
  expect(container.textContent).not.toContain('index.html');
});
