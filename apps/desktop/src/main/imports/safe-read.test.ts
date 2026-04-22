import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_FILE_BYTES, safeReadImportFile } from './safe-read';

async function freshPath(): Promise<string> {
  const dir = join(tmpdir(), `codesign-safe-read-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('safeReadImportFile', () => {
  it('returns null on ENOENT', async () => {
    const dir = await freshPath();
    expect(await safeReadImportFile(join(dir, 'missing.json'))).toBeNull();
  });

  it('returns file contents for a regular small file', async () => {
    const dir = await freshPath();
    const path = join(dir, 'ok.json');
    await writeFile(path, '{"a":1}', 'utf8');
    expect(await safeReadImportFile(path)).toBe('{"a":1}');
  });

  it('returns null when the path is a directory', async () => {
    const dir = await freshPath();
    expect(await safeReadImportFile(dir)).toBeNull();
  });

  it('returns null when the file exceeds MAX_IMPORT_FILE_BYTES', async () => {
    const dir = await freshPath();
    const path = join(dir, 'huge.txt');
    const content = 'x'.repeat(MAX_IMPORT_FILE_BYTES + 1);
    await writeFile(path, content, 'utf8');
    expect(await safeReadImportFile(path)).toBeNull();
  });

  it('accepts a symlink to a regular small file (legitimate dotfile repo pattern)', async () => {
    const dir = await freshPath();
    const target = join(dir, 'target.env');
    await writeFile(target, 'GEMINI_API_KEY=AIzaSy...', 'utf8');
    const link = join(dir, 'link.env');
    await symlink(target, link);
    expect(await safeReadImportFile(link)).toBe('GEMINI_API_KEY=AIzaSy...');
  });
});
