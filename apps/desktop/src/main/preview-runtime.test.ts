import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isRuntimeConsoleNoise, isRuntimeOptionalFontUrl, runPreview } from './preview-runtime';

// Puppeteer-core is a thin Chrome DevTools client — when no system Chrome is
// discoverable (typical CI sandbox), the module itself still imports fine but
// `findSystemChrome` throws EXPORTER_NO_CHROME. We key availability off that
// discovery so CI runs stay green without Chrome installed.
async function canRunChrome(): Promise<boolean> {
  try {
    const { findSystemChrome } = await import('@open-codesign/exporters');
    await findSystemChrome();
    return true;
  } catch {
    return false;
  }
}

const chromeAvailable = await canRunChrome();
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
const describeIfChrome = chromeAvailable ? describe : describe.skip;

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-preview-runtime-'));
});

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('runPreview path guards', () => {
  it('refuses paths that escape the workspace', async () => {
    const result = await runPreview({
      path: '../etc/passwd',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/escapes workspace root/);
  });

  it('reports read failure when the target does not exist', async () => {
    const result = await runPreview({
      path: 'missing.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/read failed/);
  });

  it('reports unsupported file types before launching Chrome', async () => {
    writeFileSync(join(tempDir, 'style.css'), 'body { color: red; }', 'utf8');
    const result = await runPreview({
      path: 'style.css',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Unsupported preview file type/);
  });
});

describe('runtime noise filtering', () => {
  it('recognizes only the optional fonts injected by the JSX preview wrapper', () => {
    expect(
      isRuntimeOptionalFontUrl(
        'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300&display=swap',
      ),
    ).toBe(true);
    expect(isRuntimeOptionalFontUrl('https://fonts.gstatic.com/s/dmsans/v16/example.woff2')).toBe(
      true,
    );
    expect(isRuntimeOptionalFontUrl('https://example.com/assets/hero.png')).toBe(false);
    expect(isRuntimeOptionalFontUrl('file:///tmp/workspace/assets/hero.png')).toBe(false);
  });

  it('filters optional runtime font console failures only when the wrapper is active', () => {
    const message = 'Failed to load resource: net::ERR_NETWORK_CHANGED';
    const locationUrl =
      'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300&display=swap';
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: true,
        locationUrl,
      }),
    ).toBe(true);
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: false,
        locationUrl,
      }),
    ).toBe(false);
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: true,
        locationUrl: 'https://example.com/assets/hero.png',
      }),
    ).toBe(false);
  });
});

describeIfChrome('runPreview with real Chrome', () => {
  it('captures console errors from the rendered page', async () => {
    const file = join(tempDir, 'boom.html');
    writeFileSync(
      file,
      '<!doctype html><html><body><h1>Hi</h1><script>console.error("boom");</script></body></html>',
      'utf8',
    );
    const result = await runPreview({
      path: 'boom.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.consoleErrors.some((e) => /boom/.test(e.message))).toBe(true);
    expect(result.metrics.nodes).toBeGreaterThan(0);
  }, 30_000);

  it('returns a DOM outline (not a screenshot) when vision=false', async () => {
    const file = join(tempDir, 'plain.html');
    writeFileSync(
      file,
      '<!doctype html><html><body><main><section><p>A</p></section></main></body></html>',
      'utf8',
    );
    const result = await runPreview({
      path: 'plain.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.screenshot).toBeUndefined();
    expect(typeof result.domOutline).toBe('string');
    expect((result.domOutline ?? '').length).toBeGreaterThan(0);
  }, 30_000);

  it('resolves relative scripts from HTML files against the workspace', async () => {
    writeFileSync(
      join(tempDir, 'relative.html'),
      '<!doctype html><html><body><div id="root"></div><script src="./relative.js"></script></body></html>',
      'utf8',
    );
    writeFileSync(
      join(tempDir, 'relative.js'),
      'document.getElementById("root").innerHTML = "<main id=\\"relative-root\\">Relative</main>";',
      'utf8',
    );
    const result = await runPreview({
      path: 'relative.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#relative-root');
  }, 30_000);

  it('renders standalone JSX files through the preview runtime', async () => {
    writeFileSync(
      join(tempDir, 'App.jsx'),
      'function App() { return <main id="jsx-root">Hello JSX</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'App.jsx',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#jsx-root');
  }, 30_000);

  it('renders JSX saved as HTML when it uses vendored runtime components', async () => {
    writeFileSync(
      join(tempDir, 'RuntimeFrame.html'),
      [
        'function App() {',
        '  return <IOSDevice><main id="runtime-frame-root">Inside iOS frame</main></IOSDevice>;',
        '}',
        'ReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      ].join('\n'),
      'utf8',
    );
    const result = await runPreview({
      path: 'RuntimeFrame.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.metrics.nodes).toBeGreaterThan(20);
  }, 30_000);

  it('does not follow source-reference-looking strings inside JSX files', async () => {
    writeFileSync(
      join(tempDir, 'Marker.jsx'),
      'const marker = "<!-- artifact source lives in missing.jsx -->";\nfunction App() { return <main id="marker-root">{marker}</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'Marker.jsx',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#marker-root');
  }, 30_000);

  it('renders placeholder HTML files through their referenced JSX source', async () => {
    writeFileSync(
      join(tempDir, 'index.html'),
      '<!doctype html><html><body><!-- artifact source lives in index.jsx --></body></html>',
      'utf8',
    );
    writeFileSync(
      join(tempDir, 'index.jsx'),
      'function App() { return <main id="placeholder-jsx-root">Placeholder JSX</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'index.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#placeholder-jsx-root');
  }, 30_000);

  it('renders standalone TSX files through the preview runtime', async () => {
    writeFileSync(
      join(tempDir, 'App.tsx'),
      'function App(): JSX.Element { const label: string = "Hello TSX"; return <main id="tsx-root">{label}</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'App.tsx',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#tsx-root');
  }, 30_000);
});
