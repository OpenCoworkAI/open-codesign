import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import { DEMO_INPUTS } from '@open-codesign/templates/demo-inputs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as demoInputs from './demo-inputs';
import { app } from './electron-runtime';
import { initInMemoryDb, listDesigns } from './snapshots-db';
import { registerSnapshotsIpc } from './snapshots-ipc';

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
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codesign-demo-ipc-'));
  vi.mocked(app.getPath).mockReturnValue(root);
  handlers.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function setup() {
  const db = initInMemoryDb();
  registerSnapshotsIpc(db);
  const create = handlers.get('snapshots:v1:create-design');
  if (!create) throw new Error('Missing create handler');
  return { db, create };
}

describe('new design demo input IPC', () => {
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
    const { create } = setup();
    const plain = await create(null, { schemaVersion: 1, name: 'Demo' });
    const first = await create(null, { schemaVersion: 1, name: 'Demo', demoInputId: 'daymark' });
    const second = await create(null, { schemaVersion: 1, name: 'Demo', demoInputId: 'daymark' });
    expect(new Set([plain.workspacePath, first.workspacePath, second.workspacePath]).size).toBe(3);
    expect(await readdir(plain.workspacePath ?? '')).not.toContain('product-brief.md');
  });
});
