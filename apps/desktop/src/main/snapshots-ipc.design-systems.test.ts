import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Design } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './electron-runtime';
import { initInMemoryDb, listDesigns } from './snapshots-db';
import { registerSnapshotsIpc } from './snapshots-ipc';

type Handler = (event: unknown, raw: unknown) => Promise<Design>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
const apply = vi.hoisted(() => vi.fn());
vi.mock('./electron-runtime', () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('./design-system-library-ipc', () => ({ applyLibrarySystem: apply }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'system-create-'));
  vi.mocked(app.getPath).mockReturnValue(root);
  handlers.clear();
  apply.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function setup() {
  const db = initInMemoryDb();
  registerSnapshotsIpc(db);
  const create = handlers.get('snapshots:v1:create-design');
  if (!create) throw new Error('Missing create handler');
  return { db, create };
}
describe('new design with optional system', () => {
  it('copies the chosen system before returning the new design', async () => {
    const { create } = setup();
    apply.mockImplementation(async (_id: string, workspace: string) => {
      await writeFile(path.join(workspace, 'DESIGN.md'), 'Chosen system');
    });
    const design = await create(null, {
      schemaVersion: 1,
      name: 'Design',
      designSystemId: 'builtin:ibm',
    });
    expect(await readFile(path.join(design.workspacePath ?? '', 'DESIGN.md'), 'utf8')).toBe(
      'Chosen system',
    );
    expect(apply).toHaveBeenCalledWith('builtin:ibm', expect.any(String));
  });
  it('keeps ordinary creation optional and untouched', async () => {
    const { create } = setup();
    const design = await create(null, { schemaVersion: 1, name: 'Plain' });
    expect(apply).not.toHaveBeenCalled();
    expect(await readdir(design.workspacePath ?? '')).not.toContain('DESIGN.md');
  });
  it('keeps an existing specification intact before binding or copying', async () => {
    const { db, create } = setup();
    const workspacePath = path.join(root, 'existing');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, 'DESIGN.md'), 'Original');
    await expect(
      create(null, {
        schemaVersion: 1,
        name: 'Design',
        workspacePath,
        designSystemId: 'builtin:ibm',
      }),
    ).rejects.toMatchObject({ code: 'IPC_CONFLICT' });
    expect(listDesigns(db)).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    expect(await readdir(workspacePath)).toEqual(['DESIGN.md']);
  });
  it('rolls back a new automatic workspace on validation or copy failure', async () => {
    const { db, create } = setup();
    apply.mockRejectedValue(new Error('Preview failed'));
    await expect(
      create(null, { schemaVersion: 1, name: 'Design', designSystemId: 'builtin:ibm' }),
    ).rejects.toThrow();
    expect(listDesigns(db)).toEqual([]);
    expect(await readdir(path.join(root, 'CoDesign'))).toEqual([]);
  });
});
