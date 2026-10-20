import { link, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitSourceEdit, SourceEditCommitError } from './source-edit-atomic';

const faults = vi.hoisted(() => ({ rename: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (faults.rename) throw new Error('injected rename failure');
      return fs.rename(...args);
    },
  };
});

let root: string;
let file: string;
beforeEach(async () => {
  faults.rename = false;
  root = await mkdtemp(path.join(tmpdir(), 'codesign-source-atomic-'));
  file = path.join(root, 'App.jsx');
  await writeFile(file, 'original');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function save(validate: () => Promise<void> = async () => {}) {
  return commitSourceEdit({
    destination: file,
    expectedContent: 'original',
    content: 'edited',
    validate,
  });
}

describe('source edit atomic commit', () => {
  it('commits a complete source and removes its stage', async () => {
    await save();
    expect(await readFile(file, 'utf8')).toBe('edited');
    expect(await readdir(root)).toEqual(['App.jsx']);
  });
  it('leaves the original intact on validation failure and cleans the stage', async () => {
    await expect(
      save(async () => {
        throw new SourceEditCommitError('cancelled', 'cancel');
      }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
    expect(await readFile(file, 'utf8')).toBe('original');
    expect(await readdir(root)).toEqual(['App.jsx']);
  });
  it('preserves an external write discovered immediately before commit', async () => {
    await expect(
      save(async () => {
        await writeFile(file, 'external');
      }),
    ).rejects.toMatchObject({ reason: 'stale-source' });
    expect(await readFile(file, 'utf8')).toBe('external');
    expect(await readdir(root)).toEqual(['App.jsx']);
  });
  it('preserves the original if rename fails and removes the stage', async () => {
    faults.rename = true;
    await expect(save()).rejects.toThrow('injected rename failure');
    expect(await readFile(file, 'utf8')).toBe('original');
    expect(await readdir(root)).toEqual(['App.jsx']);
  });
  it('refuses hard-linked targets rather than silently splitting aliases', async () => {
    await link(file, path.join(root, 'Alias.jsx'));
    await expect(save()).rejects.toMatchObject({ reason: 'unsafe-path' });
    expect(await readFile(file, 'utf8')).toBe('original');
    expect(await readFile(path.join(root, 'Alias.jsx'), 'utf8')).toBe('original');
  });
  it('detects staged content tampering without replacing the original', async () => {
    await expect(
      save(async () => {
        const stage = (await readdir(root)).find((entry) => entry.endsWith('.tmp'));
        if (!stage) throw new Error('Missing stage');
        await writeFile(path.join(root, stage), 'tampered');
      }),
    ).rejects.toMatchObject({ reason: 'stage-changed' });
    expect(await readFile(file, 'utf8')).toBe('original');
    expect(await readdir(root)).toEqual(['App.jsx']);
  });
  it('compares exact bytes, not replacement-character decoded text', async () => {
    const replacementCharacter = String.fromCharCode(0xfffd);
    await writeFile(file, replacementCharacter);
    await expect(
      commitSourceEdit({
        destination: file,
        expectedContent: replacementCharacter,
        content: 'edited',
        validate: async () => {
          await writeFile(file, Buffer.from([0xff]));
        },
      }),
    ).rejects.toMatchObject({ reason: 'stale-source' });
    expect(await readFile(file)).toEqual(Buffer.from([0xff]));
  });
  it('does not recreate a deleted target', async () => {
    await expect(
      save(async () => {
        await rm(file);
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(root)).toEqual([]);
  });
});
