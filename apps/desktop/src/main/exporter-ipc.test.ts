import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDefaultExportPath,
  ensureExportExtension,
  exportAssetOptions,
  parseRequest,
  resolveExportSource,
} from './exporter-ipc';

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-export-ipc-test-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('parseRequest', () => {
  it('rejects a null payload with IPC_BAD_INPUT', () => {
    expect(() => parseRequest(null)).toThrow(CodesignError);
    expect(() => parseRequest(null)).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('rejects an unknown format with EXPORTER_UNKNOWN', () => {
    expect(() => parseRequest({ format: 'docx', artifactSource: '<p>hi</p>' })).toThrowError(
      expect.objectContaining({ code: 'EXPORTER_UNKNOWN' }),
    );
  });

  it('rejects an empty artifactSource with IPC_BAD_INPUT', () => {
    expect(() => parseRequest({ format: 'pdf', artifactSource: '' })).toThrowError(
      expect.objectContaining({ code: 'IPC_BAD_INPUT' }),
    );
  });

  it('accepts a valid pdf request', () => {
    const result = parseRequest({
      format: 'pdf',
      artifactSource: '<html/>',
      defaultFilename: 'report.pdf',
    });
    expect(result.format).toBe('pdf');
    expect(result.artifactSource).toBe('<html/>');
    expect(result.defaultFilename).toBe('report.pdf');
  });

  it('accepts workspace source context for local asset exports', () => {
    const result = parseRequest({
      format: 'zip',
      artifactSource: '<img src="assets/logo.svg">',
      workspacePath: '/workspace',
      sourcePath: 'screens/home/index.html',
    });

    expect(result.workspacePath).toBe('/workspace');
    expect(result.sourcePath).toBe('screens/home/index.html');
    expect(exportAssetOptions(result)).toMatchObject({
      assetRootPath: '/workspace',
      assetBasePath: resolve('/workspace', 'screens/home'),
      sourcePath: 'screens/home/index.html',
    });
  });

  it('accepts design identity for workspace-first export resolution and naming', () => {
    const result = parseRequest({
      format: 'html',
      artifactSource: '<main>preview cache</main>',
      designId: 'design-1',
      designName: 'Launch / Deck: Q2',
      workspacePath: '/workspace',
      sourcePath: 'App.jsx',
    });

    expect(result.designId).toBe('design-1');
    expect(result.designName).toBe('Launch / Deck: Q2');
  });

  it('preserves sourcePath for export classification even without a workspace path', () => {
    const result = parseRequest({
      format: 'html',
      artifactSource: 'function App() { return <main />; }',
      sourcePath: 'App.tsx',
    });

    expect(exportAssetOptions(result)).toEqual({ sourcePath: 'App.tsx' });
  });

  it('normalizes backslash sourcePath separators before resolving assets', () => {
    const result = parseRequest({
      format: 'html',
      artifactSource: 'function App() { return <main />; }',
      workspacePath: '/workspace',
      sourcePath: 'screens\\home\\App.jsx',
    });

    expect(result.sourcePath).toBe('screens/home/App.jsx');
    expect(exportAssetOptions(result)).toMatchObject({
      assetBasePath: resolve('/workspace', 'screens/home'),
      sourcePath: 'screens/home/App.jsx',
    });
  });

  it('rejects unsafe sourcePath values before resolving export assets', () => {
    for (const sourcePath of ['/tmp/App.jsx', '../App.jsx', 'screens/../App.jsx', 'file:App.jsx']) {
      expect(() =>
        parseRequest({
          format: 'html',
          artifactSource: 'function App() { return <main />; }',
          sourcePath,
        }),
      ).toThrowError(expect.objectContaining({ code: 'IPC_BAD_INPUT' }));
    }
  });
});

describe('export path helpers', () => {
  it('builds a stable Downloads export path from design name, source path, format, and time', () => {
    const out = buildDefaultExportPath({
      format: 'pptx',
      downloadsPath: '/Users/roy/Downloads',
      designName: 'Launch / Deck: Q2',
      sourcePath: 'screens/Home.tsx',
      now: new Date('2026-05-05T10:20:30.000Z'),
    });

    expect(out).toBe(join('/Users/roy/Downloads', 'Launch-Deck-Q2-Home-2026-05-05-102030.pptx'));
  });

  it('falls back to an open-codesign name inside Downloads when no design name is available', () => {
    const out = buildDefaultExportPath({
      format: 'markdown',
      downloadsPath: '/Users/roy/Downloads',
      designName: '',
      sourcePath: 'App.jsx',
      now: new Date('2026-05-05T10:20:30.000Z'),
    });

    expect(out).toBe(join('/Users/roy/Downloads', 'open-codesign-App-2026-05-05-102030.md'));
  });

  it('treats legacy defaultFilename as a Downloads filename, not a cwd-relative path', () => {
    const out = buildDefaultExportPath({
      format: 'html',
      downloadsPath: '/Users/roy/Downloads',
      defaultFilename: 'codesign-2026-05-05T06-04-43.html',
      now: new Date('2026-05-05T10:20:30.000Z'),
    });

    expect(out).toBe(join('/Users/roy/Downloads', 'codesign-2026-05-05T06-04-43.html'));
  });

  it('keeps legacy defaultFilename on the requested format extension', () => {
    const out = buildDefaultExportPath({
      format: 'pdf',
      downloadsPath: '/Users/roy/Downloads',
      defaultFilename: 'preview.html',
      now: new Date('2026-05-05T10:20:30.000Z'),
    });

    expect(out).toBe(join('/Users/roy/Downloads', 'preview.html.pdf'));
  });

  it('keeps export files on the selected format extension', () => {
    expect(ensureExportExtension('/tmp/report', 'pdf')).toBe('/tmp/report.pdf');
    expect(ensureExportExtension('/tmp/report.PDF', 'pdf')).toBe('/tmp/report.PDF');
    expect(ensureExportExtension('/tmp/report.txt', 'pdf')).toBe('/tmp/report.txt.pdf');
    expect(ensureExportExtension('/tmp/report.markdown', 'markdown')).toBe(
      '/tmp/report.markdown.md',
    );
  });
});

describe('resolveExportSource', () => {
  it('prefers the current workspace source over the renderer preview cache', async () => {
    mkdirSync(join(tempDir, 'workspace'), { recursive: true });
    writeFileSync(
      join(tempDir, 'workspace', 'App.jsx'),
      'function App(){ return <main>disk</main>; }',
    );

    const req = parseRequest({
      format: 'html',
      artifactSource: '<main>stale-preview</main>',
      designId: 'design-1',
      workspacePath: join(tempDir, 'workspace'),
      sourcePath: 'App.jsx',
    });

    const resolved = await resolveExportSource(req);
    expect(resolved.artifactSource).toBe('function App(){ return <main>disk</main>; }');
    expect(resolved.sourcePath).toBe('App.jsx');
  });

  it('resolves placeholder HTML to the referenced JSX source before export', async () => {
    const workspace = join(tempDir, 'referenced-workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      join(workspace, 'index.html'),
      '<!doctype html><body><!-- artifact source lives in index.jsx --></body>',
    );
    writeFileSync(join(workspace, 'index.jsx'), 'function App(){ return <main>real</main>; }');

    const req = parseRequest({
      format: 'zip',
      artifactSource: readFileSync(join(workspace, 'index.html'), 'utf8'),
      workspacePath: workspace,
      sourcePath: 'index.html',
    });

    const resolved = await resolveExportSource(req);
    expect(resolved.artifactSource).toBe('function App(){ return <main>real</main>; }');
    expect(resolved.sourcePath).toBe('index.jsx');
  });
});
