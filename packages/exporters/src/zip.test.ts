import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportZip } from './zip';

let tempDir = '';

beforeAll(() => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'codesign-zip-test-')));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('exportZip', () => {
  it('writes a multi-asset bundle with index.html, README.md and assets/', async () => {
    const dest = join(tempDir, 'bundle.zip');
    const result = await exportZip('<h1>hi</h1>', dest, {
      assets: [
        { path: 'assets/logo.svg', content: '<svg></svg>' },
        { path: 'assets/data.bin', content: Buffer.from([1, 2, 3, 4]) },
      ],
      readmeTitle: 'Test bundle',
    });

    expect(existsSync(dest)).toBe(true);
    expect(result.bytes).toBeGreaterThan(100);

    const { Unzip } = await import('zip-lib');
    const extractDir = join(tempDir, 'extracted');
    const unzip = new Unzip();
    await unzip.extract(dest, extractDir);

    expect(existsSync(join(extractDir, 'index.html'))).toBe(true);
    expect(existsSync(join(extractDir, 'README.md'))).toBe(true);
    expect(existsSync(join(extractDir, 'assets', 'logo.svg'))).toBe(true);
    expect(existsSync(join(extractDir, 'assets', 'data.bin'))).toBe(true);

    const { readFile } = await import('node:fs/promises');
    const readme = await readFile(join(extractDir, 'README.md'), 'utf8');
    expect(readme).toContain('Test bundle');
    expect(readme).toContain('open-codesign');
  });

  it('produces a valid zip without any extra assets', async () => {
    const dest = join(tempDir, 'minimal.zip');
    const result = await exportZip('<p>x</p>', dest);
    expect(result.bytes).toBeGreaterThan(50);
  });

  it('throws EXPORTER_ZIP_FAILED when the destination cannot be written', async () => {
    // Pass a directory as the destination — zip-lib will fail to write a regular file there.
    await expect(exportZip('<p>x</p>', tempDir)).rejects.toMatchObject({
      code: 'EXPORTER_ZIP_FAILED',
    });
  });
});
