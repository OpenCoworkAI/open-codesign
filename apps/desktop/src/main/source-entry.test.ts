import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withWorkspaceFileWriter } from '@open-codesign/shared/workspace-file-lock';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bindWorkspace, copyTrackedWorkspaceFiles } from './design-workspace';
import * as database from './snapshots-db';
import {
  createDesign,
  getDesign,
  initInMemoryDb,
  softDeleteDesign,
  updateDesignPreview,
  updateDesignWorkspace,
} from './snapshots-db';
import * as entries from './source-entry';
import * as store from './source-entry-store';
import { normalizeWorkspacePath } from './workspace-path';
import { runWithWorkspaceRenameQueue, withStableWorkspacePath } from './workspace-path-lock';

vi.mock('electron', () => ({ dialog: {}, shell: {} }));
vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

beforeAll(async () => {
  await import('@open-codesign/runtime');
}, 60_000);

const roots: string[] = [];
const validate = () => {};
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'source-entry-')));
  roots.push(root);
  const db = { ...initInMemoryDb(), sessionDir: path.join(root, 'sessions') };
  const design = createDesign(db);
  const workspace = normalizeWorkspacePath(path.join(root, 'workspace'));
  await mkdir(workspace);
  updateDesignWorkspace(db, design.id, workspace);
  const metadata = path.join(
    db.sessionDir,
    'source-entries',
    `${createHash('sha256').update(design.id).digest('hex')}.json`,
  );
  const select = async (file: string, revision: string | null = null) =>
    entries.selectSourceEntry(
      db,
      {
        schemaVersion: 1,
        designId: design.id,
        path: file,
        expectedWorkspacePath: workspace,
        expectedRevision: revision,
      },
      validate,
    );
  return { root, db, design, workspace, metadata, select };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('source entries', () => {
  it('declares a missing native source without creating workspace files or confirming on read', async () => {
    const f = await fixture();
    const planned = await entries.initializeSourceEntry(f.db, f.design.id);
    expect(planned).toMatchObject({
      phase: 'planned',
      source: { path: 'index.html', format: 'html', runtimeMode: 'native-html' },
    });
    expect(await readdir(f.workspace)).toEqual([]);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'planned',
      content: null,
    });
    const before = await readFile(f.metadata, 'utf8');
    await writeFile(path.join(f.workspace, 'index.html'), '<main>unfinished</main>');
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'planned',
      content: '<main>unfinished</main>',
    });
    expect(await readFile(f.metadata, 'utf8')).toBe(before);
  });

  it('resolves a unique legacy source without writing metadata', async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.workspace, 'App.jsx'),
      'export default function App() { return <h1>Hi</h1>; }',
    );
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'ready',
      origin: 'legacy',
      revision: null,
      source: { path: 'App.jsx', runtimeMode: 'legacy-auto' },
    });
    await expect(readdir(f.db.sessionDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires selection for independent sources and distinguishes identical content at different paths', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'App.jsx'), 'export default () => <h1>Hi</h1>;');
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>Hi</h1>');
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'needs-selection',
      reason: 'ambiguous-candidates',
    });
    const selected = await f.select('index.html');
    await writeFile(path.join(f.workspace, 'other.html'), '<h1>Hi</h1>');
    const second = await f.select('other.html', selected.revision);
    expect(second.source?.path).toBe('other.html');
    expect(second.revision).not.toBe(selected.revision);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'ready',
      source: { path: 'other.html' },
    });
  });

  it('resolves legacy placeholder references to the actual source and deduplicates candidates', async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.workspace, 'index.html'),
      '<!-- artifact source lives in App.tsx -->',
    );
    await writeFile(
      path.join(f.workspace, 'App.tsx'),
      'export default function App() { return <h1>Hi</h1>; }',
    );
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'ready',
      source: { path: 'App.tsx', format: 'tsx' },
    });
  });

  it.each([
    null,
    '',
  ])('fails closed for a missing or empty reference target: %s', async (content) => {
    const f = await fixture();
    await writeFile(
      path.join(f.workspace, 'index.html'),
      '<!-- artifact source lives in nested/App.jsx -->',
    );
    await writeFile(path.join(f.workspace, 'App.jsx'), 'export default () => <h1>Other</h1>;');
    if (content !== null) {
      await mkdir(path.join(f.workspace, 'nested'));
      await writeFile(path.join(f.workspace, 'nested/App.jsx'), content);
    }
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'invalid' });
  });

  it('does not interpret a native document comment as a source redirection', async () => {
    const f = await fixture();
    const planned = await entries.initializeSourceEntry(f.db, f.design.id);
    const content = '<!-- artifact source lives in missing.jsx --><h1>Native</h1>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await entries.confirmSourceEntry(
      f.db,
      {
        schemaVersion: 1,
        designId: f.design.id,
        expectedWorkspacePath: f.workspace,
        expectedRevision: planned.revision,
        source: planned.source,
        expectedContent: content,
      },
      validate,
    );
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'ready',
      source: { path: 'index.html', runtimeMode: 'native-html' },
      content,
    });
  });

  it('does not substitute legacy candidates after a confirmed source is deleted or emptied', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'custom.html'), '<main>Accepted</main>');
    await f.select('custom.html');
    await writeFile(path.join(f.workspace, 'App.jsx'), 'export default () => <div/>;');
    await rm(path.join(f.workspace, 'custom.html'));
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'source-missing',
    });
    await writeFile(path.join(f.workspace, 'custom.html'), '   ');
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'source-empty',
    });
  });

  it.each([
    '{',
    '{"schemaVersion":2}',
    '{"schemaVersion":1,"designId":"other"}',
  ])('preserves malformed or unsupported metadata: %s', async (bad) => {
    const f = await fixture();
    await mkdir(path.dirname(f.metadata), { recursive: true });
    await writeFile(f.metadata, bad);
    await writeFile(path.join(f.workspace, 'index.html'), '<main>Hi</main>');
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'invalid-metadata',
    });
    await expect(f.select('index.html')).rejects.toMatchObject({ reason: 'invalid-metadata' });
    await expect(entries.initializeSourceEntry(f.db, f.design.id)).rejects.toMatchObject({
      reason: 'invalid-metadata',
    });
    await expect(bindWorkspace(f.db, f.design.id, f.workspace, false)).rejects.toMatchObject({
      reason: 'invalid-metadata',
    });
    expect(await readFile(f.metadata, 'utf8')).toBe(bad);
  });

  it('keeps entries isolated for two designs sharing a workspace', async () => {
    const f = await fixture();
    const other = createDesign(f.db);
    updateDesignWorkspace(f.db, other.id, f.workspace);
    await writeFile(path.join(f.workspace, 'one.html'), '<h1>One</h1>');
    await writeFile(path.join(f.workspace, 'two.html'), '<h1>Two</h1>');
    await f.select('one.html');
    await entries.selectSourceEntry(
      f.db,
      {
        schemaVersion: 1,
        designId: other.id,
        path: 'two.html',
        expectedWorkspacePath: f.workspace,
        expectedRevision: null,
      },
      validate,
    );
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      source: { path: 'one.html' },
    });
    expect(await entries.getSourceEntry(f.db, other.id)).toMatchObject({
      source: { path: 'two.html' },
    });
  });

  it('rejects stale revisions, changed content, and host validation failures without replacing metadata', async () => {
    const f = await fixture();
    const planned = await entries.initializeSourceEntry(f.db, f.design.id);
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>Changed</h1>');
    const input = {
      schemaVersion: 1 as const,
      designId: f.design.id,
      expectedWorkspacePath: f.workspace,
      expectedRevision: planned.revision,
      source: planned.source,
      expectedContent: '<h1>Before</h1>',
    };
    const before = await readFile(f.metadata, 'utf8');
    await expect(entries.confirmSourceEntry(f.db, input, validate)).rejects.toMatchObject({
      reason: 'source-changed',
    });
    await expect(f.select('index.html')).rejects.toMatchObject({ reason: 'revision-changed' });
    await expect(
      entries.confirmSourceEntry(f.db, { ...input, expectedContent: '<h1>Changed</h1>' }, () => {
        throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
    expect(await readFile(f.metadata, 'utf8')).toBe(before);
  });

  it('serializes simultaneous selections so only one request with the same revision succeeds', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'one.html'), '<h1>One</h1>');
    await writeFile(path.join(f.workspace, 'two.html'), '<h1>Two</h1>');
    const results = await Promise.allSettled([f.select('one.html'), f.select('two.html')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('invalidates rebindings including A to B to A and preserves an unbind tombstone', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>A</h1>');
    const original = await f.select('index.html');
    const next = path.join(f.root, 'next');
    await mkdir(next);
    await bindWorkspace(f.db, f.design.id, next, false);
    const rebound = await entries.getSourceEntry(f.db, f.design.id);
    expect(rebound).toMatchObject({ status: 'invalid', reason: 'invalidated' });
    await bindWorkspace(f.db, f.design.id, f.workspace, false);
    await expect(f.select('index.html', original.revision)).rejects.toMatchObject({
      reason: 'revision-changed',
    });
    await bindWorkspace(f.db, f.design.id, null, false);
    const unbound = JSON.parse(await readFile(f.metadata, 'utf8'));
    expect(unbound).toMatchObject({ phase: 'invalidated', workspacePath: null });
    await bindWorkspace(f.db, f.design.id, f.workspace, false);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'invalidated',
    });
    expect(JSON.parse(await readFile(f.metadata, 'utf8')).revision).not.toBe(unbound.revision);
  });

  it('preserves identity through migration and leaves metadata unchanged on collision', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'other.html'), '<h1>A</h1>');
    const original = await f.select('other.html');
    const next = path.join(f.root, 'next');
    await mkdir(next);
    await writeFile(path.join(next, 'other.html'), 'collision');
    const before = await readFile(f.metadata, 'utf8');
    await expect(bindWorkspace(f.db, f.design.id, next, true)).rejects.toThrow('collision');
    expect(await readFile(f.metadata, 'utf8')).toBe(before);
    expect(getDesign(f.db, f.design.id)?.workspacePath).toBe(f.workspace);
    await rm(path.join(next, 'other.html'));
    await bindWorkspace(f.db, f.design.id, next, true);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'ready',
      source: original.source,
      workspacePath: normalizeWorkspacePath(next),
    });
  });

  it('does not rebind an undeclared design if the tombstone cannot be persisted', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>Original</h1>');
    const next = path.join(f.root, 'next');
    await mkdir(next);
    await writeFile(path.join(next, 'index.html'), '<h1>Unrelated</h1>');
    vi.spyOn(store, 'writeSourceEntryFile').mockRejectedValueOnce(new Error('Disk full'));
    await expect(bindWorkspace(f.db, f.design.id, next, false)).rejects.toThrow('Disk full');
    expect(getDesign(f.db, f.design.id)?.workspacePath).toBe(f.workspace);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      content: '<h1>Original</h1>',
    });
  });

  it('fails closed if DB rebinding fails after committing its tombstone', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>Original</h1>');
    const next = path.join(f.root, 'next');
    await mkdir(next);
    vi.spyOn(database, 'updateDesignWorkspace').mockImplementationOnce(() => {
      throw new Error('DB write failed');
    });
    await expect(bindWorkspace(f.db, f.design.id, next, false)).rejects.toThrow('DB write failed');
    expect(getDesign(f.db, f.design.id)?.workspacePath).toBe(f.workspace);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'binding-mismatch',
    });
    expect(await store.readSourceEntryFile(f.db, f.design.id)).toMatchObject({
      phase: 'invalidated',
      workspacePath: normalizeWorkspacePath(next),
    });
  });

  it('recovers a binding mismatch only through explicit selection with the current binding and latest revision', async () => {
    const f = await fixture();
    const original = await entries.initializeSourceEntry(f.db, f.design.id);
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>Original</h1>');
    const next = path.join(f.root, 'next');
    await mkdir(next);
    vi.spyOn(database, 'updateDesignWorkspace').mockImplementationOnce(() => {
      throw new Error('DB write failed');
    });
    await expect(bindWorkspace(f.db, f.design.id, next, false)).rejects.toThrow('DB write failed');
    const mismatch = await store.readSourceEntryFile(f.db, f.design.id);
    if (!mismatch) throw new Error('Missing mismatch entry');
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      reason: 'binding-mismatch',
    });
    await expect(f.select('index.html', original.revision)).rejects.toMatchObject({
      reason: 'revision-changed',
    });
    await expect(
      entries.confirmSourceEntry(
        f.db,
        {
          schemaVersion: 1,
          designId: f.design.id,
          expectedWorkspacePath: f.workspace,
          expectedRevision: mismatch.revision,
          source: original.source,
          expectedContent: '<h1>Original</h1>',
        },
        validate,
      ),
    ).rejects.toMatchObject({ reason: 'binding-mismatch' });
    const recovered = await f.select('index.html', mismatch.revision);
    expect(recovered.revision).not.toBe(mismatch.revision);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'ready',
      content: '<h1>Original</h1>',
      workspacePath: f.workspace,
    });
  });

  it('serializes rebinding behind an in-flight selection without deadlocking', async () => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>Original</h1>');
    const next = path.join(f.root, 'next');
    await mkdir(next);
    let markStarted = () => {};
    let unblock = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const selecting = entries.selectSourceEntry(
      f.db,
      {
        schemaVersion: 1,
        designId: f.design.id,
        path: 'index.html',
        expectedWorkspacePath: f.workspace,
        expectedRevision: null,
      },
      async () => {
        markStarted();
        await released;
      },
    );
    await started;
    const rebinding = bindWorkspace(f.db, f.design.id, next, false);
    expect(getDesign(f.db, f.design.id)?.workspacePath).toBe(f.workspace);
    unblock();
    const selected = await selecting;
    await rebinding;
    const result = await entries.getSourceEntry(f.db, f.design.id);
    expect(result).toMatchObject({ status: 'invalid', reason: 'invalidated' });
    expect(result.revision).not.toBe(selected.revision);
  });

  it.each([
    'source',
    'target',
  ])('rejects a duplicate whose %s changes immediately before metadata commit', async (changed) => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'index.html'), '<h1>Original</h1>');
    const target = createDesign(f.db);
    const destination = path.join(f.root, 'copy');
    await mkdir(destination);
    const write = store.writeSourceEntryFile;
    vi.spyOn(store, 'writeSourceEntryFile').mockImplementation(
      async (db, id, entry, previous, check) => {
        return write(db, id, entry, previous, async () => {
          if (id === target.id) {
            await writeFile(
              path.join(changed === 'source' ? f.workspace : destination, 'index.html'),
              '<h1>Changed</h1>',
            );
          }
          await check();
        });
      },
    );
    await expect(
      entries.duplicateWithSourceEntry(f.db, f.design.id, target.id, async () => {
        await copyTrackedWorkspaceFiles(f.db, f.design.id, f.workspace, destination);
        const bound = updateDesignWorkspace(f.db, target.id, destination);
        if (!bound) throw new Error('Missing target');
        return bound;
      }),
    ).rejects.toMatchObject({ reason: 'source-changed' });
    expect(await store.readSourceEntryFile(f.db, target.id)).toBeNull();
  });

  it.each([
    'duplicate',
    'migration',
  ] as const)('coordinates %s with source writers from another design sharing the workspace', async (operation) => {
    const f = await fixture();
    const file = path.join(f.workspace, 'index.html');
    await writeFile(file, '<h1>Original</h1>');
    await f.select('index.html');
    const other = createDesign(f.db);
    updateDesignWorkspace(f.db, other.id, f.workspace);
    const target = createDesign(f.db);
    const destination = path.join(f.root, 'destination');
    await mkdir(destination);
    let markCopied = () => {};
    let releaseCopy = () => {};
    const copied = new Promise<void>((resolve) => {
      markCopied = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const copyFiles = async () => {
      await copyTrackedWorkspaceFiles(f.db, f.design.id, f.workspace, destination);
      markCopied();
      await released;
    };
    const pending =
      operation === 'duplicate'
        ? entries.duplicateWithSourceEntry(f.db, f.design.id, target.id, async () => {
            await copyFiles();
            const bound = updateDesignWorkspace(f.db, target.id, destination);
            if (!bound) throw new Error('Missing clone');
            return bound;
          })
        : runWithWorkspaceRenameQueue(f.design.id, () =>
            entries.changeSourceEntryWorkspace(f.db, f.design.id, destination, true, copyFiles),
          );
    await copied;
    let writerEntered = false;
    const writing = withStableWorkspacePath(other.id, () =>
      withWorkspaceFileWriter(file, async () => {
        writerEntered = true;
        await writeFile(file, '<h1>Later edit</h1>');
      }),
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(writerEntered).toBe(false);
    } finally {
      releaseCopy();
      await Promise.allSettled([pending, writing]);
    }
    await pending;
    await writing;
    expect(writerEntered).toBe(true);
    expect(
      await entries.getSourceEntry(f.db, operation === 'duplicate' ? target.id : f.design.id),
    ).toMatchObject({ status: 'ready', content: '<h1>Original</h1>' });
  });

  it('does not resolve source metadata for connected previews', async () => {
    const f = await fixture();
    updateDesignPreview(f.db, f.design.id, 'connected-url', 'http://localhost:5173/');
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'not-applicable',
      reason: 'connected-url',
    });
    await expect(entries.initializeSourceEntry(f.db, f.design.id)).rejects.toMatchObject({
      reason: 'not-applicable',
    });
    await expect(readdir(f.db.sessionDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves source metadata for soft deletion', async () => {
    const f = await fixture();
    await entries.initializeSourceEntry(f.db, f.design.id);
    const before = await readFile(f.metadata, 'utf8');
    softDeleteDesign(f.db, f.design.id);
    expect(await readFile(f.metadata, 'utf8')).toBe(before);
  });

  it('fails closed if the database binding changes without updating metadata', async () => {
    const f = await fixture();
    await entries.initializeSourceEntry(f.db, f.design.id);
    updateDesignWorkspace(f.db, f.design.id, path.join(f.root, 'other'));
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'binding-mismatch',
    });
  });

  it.each([
    Buffer.from([0xff]),
    Buffer.from('a\u0000b'),
    Buffer.alloc(2 * 1024 * 1024 + 1, 65),
  ])('rejects non-text and oversized source bytes', async (bytes) => {
    const f = await fixture();
    await writeFile(path.join(f.workspace, 'index.html'), bytes);
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'invalid' });
  });

  it('rejects hard-linked source files', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'outside.html'), '<h1>Outside</h1>');
    await link(path.join(f.root, 'outside.html'), path.join(f.workspace, 'index.html'));
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'unsafe-path',
    });
  });

  it('rejects a linked metadata directory', async () => {
    const f = await fixture();
    await mkdir(f.db.sessionDir);
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    await symlink(
      outside,
      path.dirname(f.metadata),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(await entries.getSourceEntry(f.db, f.design.id)).toMatchObject({
      status: 'invalid',
      reason: 'unsafe-path',
    });
    await expect(entries.initializeSourceEntry(f.db, f.design.id)).rejects.toMatchObject({
      reason: 'unsafe-path',
    });
    expect(await readdir(outside)).toEqual([]);
  });
});
