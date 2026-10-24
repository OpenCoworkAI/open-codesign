import { randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DesignSourceEntryV1 } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initInMemoryDb } from './snapshots-db';
import { readSourceEntryFile, sourceEntryFile, writeSourceEntryFile } from './source-entry-store';

const fault = vi.hoisted(() => ({ stage: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      if (args[1] === 'wx' && fault.stage === 'open') throw new Error('injected open failure');
      const handle = await actual.open(...args);
      if (args[1] === 'wx') {
        if (fault.stage === 'write')
          vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('injected write failure'));
        if (fault.stage === 'sync')
          vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('injected sync failure'));
      }
      if (args[1] === 'r' && fault.stage === 'read-race') {
        const read = handle.readFile.bind(handle);
        vi.spyOn(handle, 'readFile').mockImplementationOnce(async () => {
          const bytes = await read();
          await actual.writeFile(args[0], '{}');
          return bytes;
        });
      }
      return handle;
    }),
    rename: vi.fn(async (...args: Parameters<typeof actual.rename>) => {
      if (fault.stage === 'rename') throw new Error('injected rename failure');
      return actual.rename(...args);
    }),
  };
});

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'source-entry-store-')));
  fault.stage = '';
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
function fixture() {
  const db = { ...initInMemoryDb(), sessionDir: path.join(root, 'sessions') };
  const entry: DesignSourceEntryV1 = {
    schemaVersion: 1,
    designId: 'design/with:unsafe-filename',
    workspacePath: root,
    revision: randomUUID(),
    phase: 'planned',
    source: { schemaVersion: 1, path: 'index.html', format: 'html', runtimeMode: 'native-html' },
  };
  return { db, entry, file: sourceEntryFile(db, entry.designId) };
}
const validate = async () => {};

describe('source-entry atomic sidecar persistence', () => {
  it.each([
    'open',
    'write',
    'sync',
    'rename',
    'validate',
  ])('preserves committed metadata on %s failure and removes its temporary file', async (stage) => {
    const { db, entry, file } = fixture();
    await writeSourceEntryFile(db, entry.designId, entry, null, validate);
    const before = await readFile(file, 'utf8');
    fault.stage = stage;
    await expect(
      writeSourceEntryFile(
        db,
        entry.designId,
        { ...entry, revision: randomUUID() },
        entry,
        async () => {
          if (stage === 'validate') throw new Error('injected validate failure');
        },
      ),
    ).rejects.toThrow(`injected ${stage} failure`);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it('rejects metadata replaced during final host validation instead of overwriting it', async () => {
    const { db, entry, file } = fixture();
    await writeSourceEntryFile(db, entry.designId, entry, null, validate);
    const other = { ...entry, revision: randomUUID() };
    await expect(
      writeSourceEntryFile(
        db,
        entry.designId,
        { ...entry, revision: randomUUID() },
        entry,
        async () => {
          await writeFile(file, JSON.stringify(other));
        },
      ),
    ).rejects.toMatchObject({ reason: 'revision-changed' });
    expect(await readSourceEntryFile(db, entry.designId)).toEqual(other);
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it('uses collision-resistant filenames and validates the full original design ID', async () => {
    const { db, entry, file } = fixture();
    expect(path.basename(file)).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(sourceEntryFile(db, 'design_with_unsafe-filename')).not.toBe(file);
    await writeSourceEntryFile(db, entry.designId, entry, null, validate);
    await writeFile(file, JSON.stringify({ ...entry, designId: 'other' }));
    await expect(readSourceEntryFile(db, entry.designId)).rejects.toMatchObject({
      reason: 'invalid-metadata',
    });
  });

  it('rejects metadata changed while reading its bytes', async () => {
    const { db, entry } = fixture();
    await writeSourceEntryFile(db, entry.designId, entry, null, validate);
    fault.stage = 'read-race';
    await expect(readSourceEntryFile(db, entry.designId)).rejects.toMatchObject({
      reason: 'invalid-metadata',
    });
  });

  it('rejects a mismatched design ID before writing a sidecar', async () => {
    const { db, entry } = fixture();
    await expect(writeSourceEntryFile(db, 'other', entry, null, validate)).rejects.toMatchObject({
      reason: 'invalid-metadata',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects hardlinked metadata without changing the linked file', async () => {
    const { db, entry, file } = fixture();
    await mkdir(path.dirname(file), { recursive: true });
    const outside = path.join(root, 'outside.json');
    await writeFile(outside, JSON.stringify(entry));
    await link(outside, file);
    await expect(readSourceEntryFile(db, entry.designId)).rejects.toMatchObject({
      reason: 'unsafe-path',
    });
    await expect(
      writeSourceEntryFile(db, entry.designId, entry, null, validate),
    ).rejects.toMatchObject({ reason: 'unsafe-path' });
    expect(await readFile(outside, 'utf8')).toBe(JSON.stringify(entry));
  });
});
