import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspaceFilesAt } from './workspace-reader';

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
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports={};');

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

  it('caps output at 200 files', async () => {
    await Promise.all(
      Array.from({ length: 250 }, (_, i) =>
        writeFile(join(root, `f${String(i).padStart(3, '0')}.html`), `<p>${i}</p>`),
      ),
    );
    const result = await readWorkspaceFilesAt(root);
    expect(result.length).toBe(200);
  });

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

  it('skips files it cannot read as UTF-8 text', async () => {
    await writeFile(join(root, 'ok.html'), '<p>ok</p>');
    // A stray NUL byte is our binary sniff. Writing .html keeps it on the
    // default pattern so we prove the binary filter (not the glob) drops it.
    await writeFile(join(root, 'binary.html'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const result = await readWorkspaceFilesAt(root);
    expect(result.map((f) => f.file)).toEqual(['ok.html']);
  });
});
