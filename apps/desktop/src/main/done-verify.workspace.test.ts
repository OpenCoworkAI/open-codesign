import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findSystemChrome } from '@open-codesign/exporters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRuntimeVerifier } from './done-verify';
import { runPreview } from './preview-runtime';

vi.mock('./logger', () => ({ getLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }));

const chromeAvailable = await findSystemChrome().then(
  () => true,
  () => false,
);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>';
const sourceFor = (first: string, second: string) =>
  `function App(){return <main><img src=${JSON.stringify(first)} alt="Logo"/><img src=${JSON.stringify(second)} alt="Poster"/></main>;} ReactDOM.createRoot(document.getElementById('root')).render(<App/>);`;

describe.skipIf(!chromeAvailable)('done workspace assets in system Chrome', () => {
  let fixture: string;
  let workspace: string;
  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'codesign-done-assets-'));
    workspace = join(fixture, 'workspace');
    await mkdir(join(workspace, 'art'), { recursive: true });
    await mkdir(join(workspace, 'screens'));
    await writeFile(join(workspace, 'logo.svg'), svg);
    await writeFile(join(workspace, 'art', 'poster.svg'), svg);
  });
  afterEach(async () => {
    await rm(fixture, { recursive: true, force: true });
  });

  it.each([
    'App.jsx',
    'screens/App.jsx',
  ])('matches preview for relative assets in %s', async (path) => {
    const prefix = path.startsWith('screens/') ? '../' : '';
    const source = sourceFor(`${prefix}logo.svg`, `${prefix}art/poster.svg`);
    await writeFile(join(workspace, path), source);
    expect(await makeRuntimeVerifier({ workspaceRoot: workspace })(source, { path })).toEqual([]);
    const preview = await runPreview({ workspaceRoot: workspace, path, vision: false });
    expect(preview.ok).toBe(true);
    expect(preview.assetErrors).toEqual([]);
  }, 60_000);

  it('reports a missing relative asset with its URL', async () => {
    const source = sourceFor('logo.svg', 'missing.svg');
    await writeFile(join(workspace, 'App.jsx'), source);
    const errors = await makeRuntimeVerifier({ workspaceRoot: workspace })(source, {
      path: 'App.jsx',
    });
    expect(errors.some((error) => error.message.includes('missing.svg'))).toBe(true);
  }, 30_000);

  it('blocks existing assets outside the bound workspace', async () => {
    const outside = join(fixture, 'private.svg');
    await writeFile(outside, svg);
    const source = sourceFor('logo.svg', pathToFileURL(outside).href);
    await writeFile(join(workspace, 'App.jsx'), source);
    const errors = await makeRuntimeVerifier({ workspaceRoot: workspace })(source, {
      path: 'App.jsx',
    });
    expect(
      errors.some(
        (error) => error.message.includes('private.svg') && error.message.includes('BLOCKED'),
      ),
    ).toBe(true);
  }, 30_000);

  it('rejects an escaping source path before browser execution', async () => {
    await expect(
      makeRuntimeVerifier({ workspaceRoot: workspace })('function App(){return null;}', {
        path: '../outside.jsx',
      }),
    ).rejects.toThrow(/escapes workspace root/);
  });
});
