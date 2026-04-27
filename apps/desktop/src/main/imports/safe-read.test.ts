import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_CODES } from '@open-codesign/shared';
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

  it('throws CONFIG_READ_FAILED when the path is a directory', async () => {
    const dir = await freshPath();
    await expect(safeReadImportFile(dir)).rejects.toMatchObject({
      code: ERROR_CODES.CONFIG_READ_FAILED,
    });
  });

  it('throws CONFIG_READ_FAILED when the file exceeds MAX_IMPORT_FILE_BYTES', async () => {
    const dir = await freshPath();
    const path = join(dir, 'huge.txt');
    const content = 'x'.repeat(MAX_IMPORT_FILE_BYTES + 1);
    await writeFile(path, content, 'utf8');
    await expect(safeReadImportFile(path)).rejects.toMatchObject({
      code: ERROR_CODES.CONFIG_READ_FAILED,
    });
  });

  it('accepts a symlink to a regular small file (legitimate dotfile repo pattern)', async (ctx) => {
    const dir = await freshPath();
    const target = join(dir, 'target.env');
    await writeFile(target, 'GEMINI_API_KEY=AIzaSy...', 'utf8');
    const link = join(dir, 'link.env');
    try {
      await symlink(target, link);
    } catch (err) {
      // Windows users without Developer Mode / admin rights cannot create
      // symlinks at all (EPERM). Skip rather than fail — the production code
      // is POSIX-pattern-agnostic, and CI on Linux/macOS keeps real coverage.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        ctx.skip();
        return;
      }
      throw err;
    }
    expect(await safeReadImportFile(link)).toBe('GEMINI_API_KEY=AIzaSy...');
  });
});
