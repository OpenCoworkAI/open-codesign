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

  it('verifies native HTML with nested scripts, styles and images without injecting React/Babel', async () => {
    const source = `<!doctype html><html><head><link rel="stylesheet" href="./native.css"></head><body>
      <p id="state">React.createElement &lt;App&gt; EDITMODE-BEGIN</p><img id="logo" src="../logo.svg">
      <script>document.addEventListener('DOMContentLoaded', () => {
        if (!window.nativeChecked) throw new Error('Native deferred checks did not run');
      });</script>
      <script defer src="./native.js"></script></body></html>`;
    await writeFile(join(workspace, 'screens', 'native.css'), '#state { --fixture-ready: yes; }');
    await writeFile(
      join(workspace, 'screens', 'native.js'),
      `
      function App() { return 'native'; }
      if (window.React || window.ReactDOM || window.Babel) throw new Error('Unexpected React/Babel');
      if (getComputedStyle(document.getElementById('state')).getPropertyValue('--fixture-ready').trim() !== 'yes') throw new Error('Missing stylesheet');
      window.nativeChecked = true;
      const image = document.getElementById('logo');
      const checkImage = () => { if (image.naturalWidth !== 40) throw new Error('Missing image'); };
      if (image.complete) checkImage();
      else image.addEventListener('load', checkImage, { once: true });
    `,
    );
    await writeFile(join(workspace, 'screens', 'native.jsx'), source);
    expect(
      await makeRuntimeVerifier({ workspaceRoot: workspace })(source, {
        path: 'screens/native.jsx',
        runtimeMode: 'native-html',
      }),
    ).toEqual([]);
  }, 30_000);

  it('accepts optional end tags and inert Babel, ID and link examples in authored scripts', async () => {
    const source = `<!doctype html><html><body><p id="message">First<p>Second
      <button id="check">Check</button><output id="result">Waiting</output>
      <script>
      const example = '<script type="text/babel"><p id="message"><a href="#missing"><img src="missing.png">';
      document.getElementById('check').onclick = () => { document.getElementById('result').textContent = example.includes('text/babel') ? 'Passed' : 'Failed'; };
      document.getElementById('check').click();
      if (document.getElementById('result').textContent !== 'Passed') throw new Error('Authored behavior changed');
      </script></body></html>`;
    await writeFile(join(workspace, 'screens', 'examples.html'), source);
    expect(
      await makeRuntimeVerifier({ workspaceRoot: workspace })(source, {
        path: 'screens/examples.html',
        runtimeMode: 'native-html',
      }),
    ).toEqual([]);
  });

  it('captures authored native script errors without satisfying React references automatically', async () => {
    const source =
      '<!doctype html><html><body><script>React.createElement("main");</script></body></html>';
    await writeFile(join(workspace, 'screens', 'native-error.html'), source);
    const errors = await makeRuntimeVerifier({ workspaceRoot: workspace })(source, {
      path: 'screens/native-error.html',
      runtimeMode: 'native-html',
    });
    expect(
      errors.some(
        (error) => error.source === 'pageerror' && error.message.includes('React is not defined'),
      ),
    ).toBe(true);
  }, 30_000);

  it('reports missing native resources and blocks native resources outside the workspace', async () => {
    const outside = join(fixture, 'native-private.svg');
    await writeFile(outside, svg);
    const source = `<!doctype html><html><body><p>React.createElement</p><img src="./missing-native.svg"><img src="${pathToFileURL(outside).href}"></body></html>`;
    await writeFile(join(workspace, 'screens', 'native-missing.html'), source);
    const errors = await makeRuntimeVerifier({ workspaceRoot: workspace })(source, {
      path: 'screens/native-missing.html',
      runtimeMode: 'native-html',
    });
    expect(errors.some((error) => error.message.includes('missing-native.svg'))).toBe(true);
    expect(
      errors.some(
        (error) =>
          error.message.includes('native-private.svg') && error.message.includes('BLOCKED'),
      ),
    ).toBe(true);
  }, 30_000);

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
