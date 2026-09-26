import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import { DEMO_INPUTS } from '@open-codesign/templates/demo-inputs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as demoInputs from './demo-inputs';
import { bindWorkspace } from './design-workspace';
import { app } from './electron-runtime';
import { initInMemoryDb, listDesigns } from './snapshots-db';
import { registerSnapshotsIpc } from './snapshots-ipc';
import * as sourceEntries from './source-entry';
import { getSourceEntry, selectSourceEntry } from './source-entry';
import { readSourceEntryFile } from './source-entry-store';

type Handler = (event: unknown, raw: unknown) => Promise<Design>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('./electron-runtime', () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
beforeAll(async () => {
  await import('@open-codesign/runtime');
}, 60_000);
let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codesign-demo-ipc-')));
  vi.mocked(app.getPath).mockReturnValue(root);
  handlers.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function setup() {
  const db = { ...initInMemoryDb(), sessionDir: path.join(root, 'sessions') };
  registerSnapshotsIpc(db);
  const create = handlers.get('snapshots:v1:create-design');
  if (!create) throw new Error('Missing create handler');
  return { db, create };
}

describe('new design demo input IPC', () => {
  it('does not assign the native default to an explicitly imported workspace', async () => {
    const { db, create } = setup();
    const workspacePath = path.join(root, 'imported');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, 'index.html'), '<h1>Existing</h1>');
    const design = await create(null, { schemaVersion: 1, name: 'Imported', workspacePath });
    expect(await readSourceEntryFile(db, design.id)).toBeNull();
  });

  it.each([
    'planned',
    'confirmed',
  ] as const)('duplicates %s source identity rather than assigning a default', async (phase) => {
    const { db, create } = setup();
    const original = await create(null, { schemaVersion: 1, name: 'Original' });
    let entry = await readSourceEntryFile(db, original.id);
    if (!original.workspacePath || !entry) throw new Error('Missing original entry');
    if (phase === 'confirmed') {
      await writeFile(path.join(original.workspacePath, 'custom.html'), '<h1>Selected</h1>');
      entry = await selectSourceEntry(
        db,
        {
          schemaVersion: 1,
          designId: original.id,
          path: 'custom.html',
          expectedWorkspacePath: original.workspacePath,
          expectedRevision: entry.revision,
        },
        () => {},
      );
    }
    const duplicate = handlers.get('snapshots:v1:duplicate-design');
    if (!duplicate) throw new Error('Missing duplicate handler');
    const clone = await duplicate(null, { schemaVersion: 1, id: original.id, name: 'Copy' });
    const clonedEntry = await readSourceEntryFile(db, clone.id);
    expect(clonedEntry).toMatchObject({
      phase,
      source: entry.source,
      designId: clone.id,
      workspacePath: clone.workspacePath,
    });
    expect(clonedEntry?.revision).not.toBe(entry.revision);
    expect(await readSourceEntryFile(db, original.id)).toEqual(entry);
  });

  it.each([
    'legacy',
    'ambiguous',
    'invalidated',
  ] as const)('duplicates %s designs without inventing native identity', async (state) => {
    const { db, create } = setup();
    const workspacePath = path.join(root, 'existing');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, 'App.tsx'), 'export default () => <h1>Legacy</h1>;');
    await writeFile(
      path.join(workspacePath, 'index.html'),
      state === 'ambiguous' ? '<h1>Independent</h1>' : '<!-- artifact source lives in App.tsx -->',
    );
    const original = await create(null, { schemaVersion: 1, name: 'Original', workspacePath });
    if (state === 'invalidated') {
      const other = path.join(root, 'other');
      await mkdir(other);
      await writeFile(path.join(other, 'index.html'), '<h1>Unrelated</h1>');
      await bindWorkspace(db, original.id, other, false);
    }
    const duplicate = handlers.get('snapshots:v1:duplicate-design');
    if (!duplicate) throw new Error('Missing duplicate handler');
    const clone = await duplicate(null, { schemaVersion: 1, id: original.id, name: 'Copy' });
    const result = await getSourceEntry(db, clone.id);
    if (state === 'legacy') {
      expect(result).toMatchObject({
        status: 'ready',
        origin: 'declared',
        source: { path: 'App.tsx', format: 'tsx', runtimeMode: 'legacy-auto' },
      });
      expect(await readSourceEntryFile(db, original.id)).toBeNull();
    } else if (state === 'ambiguous') {
      expect(result).toMatchObject({ status: 'needs-selection', reason: 'ambiguous-candidates' });
      expect(await readSourceEntryFile(db, clone.id)).toBeNull();
    } else {
      expect(result).toMatchObject({ status: 'invalid', reason: 'invalidated' });
      expect(result.revision).not.toBe((await readSourceEntryFile(db, original.id))?.revision);
    }
  });

  it('removes a duplicate and its committed source metadata when duplication fails', async () => {
    const { db, create } = setup();
    const original = await create(null, { schemaVersion: 1, name: 'Original' });
    const entry = await readSourceEntryFile(db, original.id);
    const duplicateWithSource = sourceEntries.duplicateWithSourceEntry;
    vi.spyOn(sourceEntries, 'duplicateWithSourceEntry').mockImplementationOnce(async (...args) => {
      await duplicateWithSource(...args);
      throw new Error('Interrupted duplicate');
    });
    const duplicate = handlers.get('snapshots:v1:duplicate-design');
    if (!duplicate) throw new Error('Missing duplicate handler');
    await expect(
      duplicate(null, { schemaVersion: 1, id: original.id, name: 'Copy' }),
    ).rejects.toThrow();
    expect(listDesigns(db).map((design) => design.id)).toEqual([original.id]);
    expect(await readSourceEntryFile(db, original.id)).toEqual(entry);
    expect(await readdir(path.join(db.sessionDir, 'source-entries'))).toHaveLength(1);
    expect(await readdir(path.join(root, 'CoDesign'))).toEqual(['Original']);
  });

  it('removes committed source metadata during creation rollback', async () => {
    const { db, create } = setup();
    const initialize = sourceEntries.initializeSourceEntry;
    vi.spyOn(sourceEntries, 'initializeSourceEntry').mockImplementationOnce(async (...args) => {
      await initialize(...args);
      throw new Error('Interrupted after sidecar commit');
    });
    await expect(create(null, { schemaVersion: 1, name: 'Interrupted' })).rejects.toThrow();
    expect(listDesigns(db)).toEqual([]);
    expect(await readdir(path.join(db.sessionDir, 'source-entries'))).toEqual([]);
  });
  it('rolls back the new design and partial files when seeding fails', async () => {
    const { db, create } = setup();
    vi.spyOn(demoInputs, 'seedDemoInputs').mockImplementationOnce(async (workspace) => {
      await writeFile(path.join(workspace, 'product-brief.md'), 'Partial input');
      throw new Error('Disk write failed');
    });
    await expect(
      create(null, { schemaVersion: 1, name: 'Demo', demoInputId: 'daymark' }),
    ).rejects.toThrow('Workspace creation failed');
    expect(listDesigns(db)).toEqual([]);
    expect(await readdir(path.join(root, 'CoDesign'))).toEqual([]);
  });
  it.each([
    'daymark',
    'common-ground',
    'trailhead',
  ] as const)('returns %s only after its real input files exist', async (demoInputId) => {
    const { create } = setup();
    const design = await create(null, { schemaVersion: 1, name: 'Demo', demoInputId });
    expect(design.workspacePath).toBeTruthy();
    const files = await readdir(design.workspacePath ?? '');
    expect(files.filter((file) => file !== '.codesign').sort()).toEqual(
      [...DEMO_INPUTS[demoInputId].files].sort(),
    );
    expect(files).not.toContain('App.jsx');
    expect(
      await readFile(path.join(design.workspacePath ?? '', 'product-brief.md'), 'utf8'),
    ).toContain('MIT');
  });

  it.each([
    '../daymark',
    '__proto__',
    '',
    42,
  ])('rejects unknown bundle %s before creating anything', async (demoInputId) => {
    const { db, create } = setup();
    await expect(
      create(null, { schemaVersion: 1, name: 'Unsafe', demoInputId }),
    ).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
    expect(listDesigns(db)).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects explicit workspace paths and preserves existing content', async () => {
    const workspacePath = path.join(root, 'existing');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, 'mine.txt'), 'Keep me');
    const { db, create } = setup();
    await expect(
      create(null, { schemaVersion: 1, name: 'Unsafe', demoInputId: 'daymark', workspacePath }),
    ).rejects.toMatchObject({ code: 'IPC_BAD_INPUT' });
    expect(listDesigns(db)).toEqual([]);
    expect(await readdir(workspacePath)).toEqual(['mine.txt']);
  });

  it('preserves prompt-only creation and avoids collisions on repeated selections', async () => {
    const { db, create } = setup();
    const plain = await create(null, { schemaVersion: 1, name: 'Demo' });
    const first = await create(null, { schemaVersion: 1, name: 'Demo', demoInputId: 'daymark' });
    const second = await create(null, { schemaVersion: 1, name: 'Demo', demoInputId: 'daymark' });
    expect(new Set([plain.workspacePath, first.workspacePath, second.workspacePath]).size).toBe(3);
    expect(await readdir(plain.workspacePath ?? '')).not.toContain('product-brief.md');
    expect(await getSourceEntry(db, plain.id)).toMatchObject({
      status: 'planned',
      source: { path: 'index.html', runtimeMode: 'native-html' },
    });
    expect(await readSourceEntryFile(db, first.id)).toBeNull();
    expect(await readSourceEntryFile(db, second.id)).toBeNull();
  });
});
