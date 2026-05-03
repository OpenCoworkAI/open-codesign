import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHtmlDocument, exportHtml } from './html';

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-html-test-'));
  mkdirSync(join(tempDir, 'assets'), { recursive: true });
  writeFileSync(join(tempDir, 'assets', 'logo.svg'), '<svg></svg>');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('buildHtmlDocument', () => {
  it('exports JSX source as browser-openable HTML with the standalone runtime', () => {
    const out = buildHtmlDocument(
      'function App() { return <div className="p-4">hi</div>; }\nReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      { prettify: false },
    );

    expect(out).toContain('CODESIGN_STANDALONE_RUNTIME');
    expect(out).toContain('window.Babel.transform');
    expect(out).toContain('https://cdn.tailwindcss.com');
    expect(out).not.toContain('CODESIGN_OVERLAY_SCRIPT');
  });

  it('writes a self-contained HTML file with local assets inlined', async () => {
    const dest = join(tempDir, 'out.html');
    await exportHtml('<img src="assets/logo.svg">', dest, {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
      prettify: false,
    });

    const out = readFileSync(dest, 'utf8');
    expect(out).toContain('src="data:image/svg+xml;charset=utf-8,');
    expect(out).not.toContain('src="assets/logo.svg"');
  });
});
