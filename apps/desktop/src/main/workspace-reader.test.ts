import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyWorkspaceFileKind,
  listWorkspaceFilesAt,
  readWorkspaceFileAt,
  readWorkspaceFilesAt,
} from './workspace-reader';

async function makeTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'workspace-reader-'));
}

describe('readWorkspaceFilesAt', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTmp();
  });

  afterEach(async () => {
    // Vitest's tmpdir cleanup is best-effort; leaving dirs behind on failure
    // is cheaper than wrestling with rimraf on every test.
  });

  it('returns matching files and skips ignored dirs under default patterns', async () => {
    await writeFile(join(root, 'index.html'), '<!doctype html><p>hi</p>');
    await writeFile(join(root, 'app.js'), 'export const x = 1;');
    for (const dir of ['node_modules/pkg', 'build', '.next']) {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, dir, 'index.js'), 'module.exports={};');
    }

    const result = await readWorkspaceFilesAt(root);
    const files = result.map((f) => f.file).sort();
    expect(files).toEqual(['app.js', 'index.html']);
  });

  it('honours user-supplied patterns', async () => {
    await writeFile(join(root, 'README.md'), '# hi');
    await writeFile(join(root, 'index.html'), '<!doctype html>');
    const result = await readWorkspaceFilesAt(root, ['*.md']);
    expect(result.map((f) => f.file)).toEqual(['README.md']);
  });

  it('recursively matches nested files for ** patterns', async () => {
    await mkdir(join(root, 'src', 'components'), { recursive: true });
    await writeFile(join(root, 'src', 'components', 'Button.jsx'), 'export default () => null;');
    const result = await readWorkspaceFilesAt(root, ['**/*.jsx']);
    expect(result.map((f) => f.file)).toEqual(['src/components/Button.jsx']);
  });

  it('includes common text project files in the default source scan', async () => {
    await writeFile(join(root, 'App.tsx'), 'function App(): JSX.Element { return <main/>; }');
    await writeFile(join(root, 'state.ts'), 'export const state = {};');
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'README.md'), '# Notes');
    const result = await readWorkspaceFilesAt(root);
    expect(result.map((f) => f.file).sort()).toEqual([
      'App.tsx',
      'README.md',
      'package.json',
      'state.ts',
    ]);
  });

  it('caps output at 200 files', async () => {
    await Promise.all(
      Array.from({ length: 250 }, (_, i) =>
        writeFile(join(root, `f${String(i).padStart(3, '0')}.html`), `<p>${i}</p>`),
      ),
    );
    const result = await readWorkspaceFilesAt(root);
    expect(result.length).toBe(200);
  }, 20_000);

  it('caps total bytes at 2 MB', async () => {
    // 20 × 150KB = 3 MB total. We expect the reader to stop before pulling
    // all 20 in — somewhere between 13 and 15 depending on walk order.
    const chunk = 'x'.repeat(150 * 1024);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        writeFile(join(root, `big${String(i).padStart(2, '0')}.html`), chunk),
      ),
    );
    const result = await readWorkspaceFilesAt(root);
    expect(result.length).toBeLessThan(20);
    const bytes = result.reduce((n, f) => n + Buffer.byteLength(f.contents, 'utf8'), 0);
    // Allow one file of overshoot — we check the cap before admitting a file
    // but the final accepted one can push us over.
    expect(bytes).toBeLessThan(2 * 1024 * 1024 + 150 * 1024);
  });

  it('skips individual matched files larger than the per-file cap', async () => {
    await writeFile(join(root, 'package-lock.json'), 'x'.repeat(3 * 1024 * 1024));
    await writeFile(join(root, 'index.html'), '<main>ok</main>');

    const result = await readWorkspaceFilesAt(root);

    expect(result.map((f) => f.file)).toEqual(['index.html']);
  });

  it('throws when a matched source file cannot be read as UTF-8 text', async () => {
    await writeFile(join(root, 'ok.html'), '<p>ok</p>');
    // A stray NUL byte is our binary sniff. Writing .html keeps it on the
    // default pattern so we prove the binary filter (not the glob) fails it.
    await writeFile(join(root, 'binary.html'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await expect(readWorkspaceFilesAt(root)).rejects.toThrow(/Failed to read workspace file/);
  });

  it('throws when the workspace root cannot be scanned', async () => {
    await expect(readWorkspaceFilesAt(join(root, 'missing'))).rejects.toThrow(
      /Failed to scan workspace directory/,
    );
  });
});

describe('workspace file metadata/read helpers', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTmp();
  });

  it('classifies common source file extensions', () => {
    expect(classifyWorkspaceFileKind('index.html')).toBe('html');
    expect(classifyWorkspaceFileKind('App.jsx')).toBe('jsx');
    expect(classifyWorkspaceFileKind('App.tsx')).toBe('tsx');
    expect(classifyWorkspaceFileKind('style.css')).toBe('css');
    expect(classifyWorkspaceFileKind('app.js')).toBe('js');
    expect(classifyWorkspaceFileKind('DESIGN.md')).toBe('design-system');
    expect(classifyWorkspaceFileKind('README.md')).toBe('markdown');
    expect(classifyWorkspaceFileKind('notes.txt')).toBe('text');
    expect(classifyWorkspaceFileKind('data.json')).toBe('text');
    expect(classifyWorkspaceFileKind('assets/logo.png')).toBe('image');
    expect(classifyWorkspaceFileKind('demo.mp4')).toBe('video');
    expect(classifyWorkspaceFileKind('voice.wav')).toBe('audio');
    expect(classifyWorkspaceFileKind('brief.pdf')).toBe('pdf');
    expect(classifyWorkspaceFileKind('archive.zip')).toBe('asset');
  });

  it('reads a single workspace file with metadata', async () => {
    await writeFile(join(root, 'App.jsx'), 'function App() { return <main/>; }');
    const result = await readWorkspaceFileAt(root, 'App.jsx');
    expect(result.kind).toBe('jsx');
    expect(result.content).toContain('function App');
    expect(result.size).toBeGreaterThan(0);
  });

  it('lists workspace files with metadata', async () => {
    await writeFile(join(root, 'App.jsx'), 'function App() { return <main/>; }');
    const result = await listWorkspaceFilesAt(root);
    expect(result).toEqual([
      expect.objectContaining({
        path: 'App.jsx',
        kind: 'jsx',
        size: expect.any(Number),
        updatedAt: expect.any(String),
      }),
    ]);
  });

  it('throws when listing a missing workspace root', async () => {
    await expect(listWorkspaceFilesAt(join(root, 'missing'))).rejects.toThrow(
      /Failed to scan workspace directory/,
    );
  });

  it('rejects path escapes in single-file reads', async () => {
    await expect(readWorkspaceFileAt(root, '../outside.jsx')).rejects.toThrow(/escapes/);
  });

  it('rejects single-file reads through symlinked workspace path segments', async () => {
    const outside = await makeTmp();
    await writeFile(join(outside, 'secret.jsx'), 'export const secret = true;');
    try {
      await symlink(outside, join(root, 'linked'), 'dir');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }

    await expect(readWorkspaceFileAt(root, 'linked/secret.jsx')).rejects.toThrow(/symbolic link/);
  });

  it('rejects binary single-file reads', async () => {
    await writeFile(join(root, 'binary.jsx'), Buffer.from([0x00, 0x01, 0x02]));
    await expect(readWorkspaceFileAt(root, 'binary.jsx')).rejects.toThrow(/binary/);
  });

  it('rejects invalid UTF-8 single-file reads', async () => {
    await writeFile(join(root, 'invalid.jsx'), Buffer.from([0xff, 0xfe, 0xfd]));
    await expect(readWorkspaceFileAt(root, 'invalid.jsx')).rejects.toThrow(/read failed/);
  });
});
