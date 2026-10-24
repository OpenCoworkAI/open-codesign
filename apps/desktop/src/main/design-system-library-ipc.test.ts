import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Design, LibraryDesignSystemDetail } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemLibrary } from './design-system-library';
import {
  getDesignSystemLibrary,
  registerDesignSystemLibraryIpc,
} from './design-system-library-ipc';
import { defaultDesignMd } from './design-system-sample';
import { app } from './electron-runtime';
import { resolveBundledTemplatesDir } from './ensure-user-templates';
import { getDesign, initInMemoryDb, listSnapshots } from './snapshots-db';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('./electron-runtime', () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('./ensure-user-templates', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ensure-user-templates')>();
  return { ...original, resolveBundledTemplatesDir: vi.fn(original.resolveBundledTemplatesDir) };
});

describe('design system IPC', () => {
  let root: string;
  let library: DesignSystemLibrary;
  const preview = vi.fn();
  const db = initInMemoryDb();
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'system-ipc-'));
    vi.mocked(app.getPath).mockReturnValue(root);
    vi.mocked(resolveBundledTemplatesDir).mockClear();
    for (const slug of ['ibm', 'vercel', 'stripe']) {
      await mkdir(path.join(root, 'brands', slug), { recursive: true });
      await writeFile(path.join(root, 'brands', slug, 'DESIGN.md'), defaultDesignMd(slug));
    }
    library = new DesignSystemLibrary({
      root: path.join(root, 'library'),
      builtinRoot: path.join(root, 'brands'),
    });
    preview.mockReset().mockResolvedValue({
      ok: true,
      screenshot: 'data:image/png;base64,eA==',
      consoleErrors: [],
      assetErrors: [],
      metrics: { nodes: 10, width: 1280, height: 800, loadMs: 1 },
    });
    handlers.clear();
    registerDesignSystemLibraryIpc(db, library, preview);
  });
  afterEach(async () => {
    vi.mocked(resolveBundledTemplatesDir).mockReset();
    await rm(root, { recursive: true, force: true });
  });
  async function call(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const handler = handlers.get(`design-systems:v1:${action}`);
    if (!handler) throw new Error(`Missing ${action}`);
    return handler(null, { schemaVersion: 1, ...payload });
  }
  it('opens a persistent editor session with an initial snapshot for element comments', async () => {
    const detail = (await call('create', { name: 'My system' })) as LibraryDesignSystemDetail;
    const editor = (await call('edit', { id: detail.system.id })) as Design;
    expect(editor.designSystemId).toBe(detail.system.id);
    expect(path.resolve(editor.workspacePath ?? '')).toBe(
      path.resolve(detail.system.workspacePath),
    );
    expect(listSnapshots(db, editor.id)).toHaveLength(1);
    expect(((await call('edit', { id: detail.system.id })) as Design).id).toBe(editor.id);
    expect(getDesign(db, editor.id)?.designSystemId).toBe(detail.system.id);
  });
  it('never edits built-in references', async () => {
    await expect(call('edit', { id: 'builtin:ibm' })).rejects.toThrow();
  });
  it('registers handlers without resolving optional template resources at startup', () => {
    handlers.clear();
    expect(() => registerDesignSystemLibraryIpc(db)).not.toThrow();
    expect(resolveBundledTemplatesDir).not.toHaveBeenCalled();
    expect(handlers.size).toBe(10);
    expect(handlers.has('design-systems:v1:list')).toBe(true);
  });
  it('limits missing-template failures to library requests and can recover on the next request', async () => {
    handlers.clear();
    vi.mocked(resolveBundledTemplatesDir).mockReturnValue(null);
    let continuedStartup = false;
    expect(() => {
      registerDesignSystemLibraryIpc(db);
      continuedStartup = true;
    }).not.toThrow();
    expect(continuedStartup).toBe(true);
    expect(resolveBundledTemplatesDir).not.toHaveBeenCalled();
    await expect(call('list')).rejects.toMatchObject({ code: 'IPC_NOT_FOUND' });
    expect(handlers.size).toBe(10);
    vi.mocked(resolveBundledTemplatesDir).mockReturnValue(path.resolve('resources/templates'));
    const systems = (await call('list')) as Array<{ id: string }>;
    expect(systems.map((system) => system.id)).toEqual([
      'builtin:ibm',
      'builtin:vercel',
      'builtin:stripe',
    ]);
  });
  it('uses current bundled built-ins without replacing an existing user-owned reference', async () => {
    vi.mocked(app.getPath).mockReturnValue(root);
    const oldPath = path.join(root, 'templates', 'brand-refs', 'ibm', 'DESIGN.md');
    const legacy = '---\nname: Old IBM\ntypography:\n  display:\n    weight: 300\n---\n';
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, legacy);
    const current = getDesignSystemLibrary();
    expect(current.root).toBe(path.join(root, 'design-systems'));
    expect(current.builtinRoot).toBe(path.resolve('resources/templates/brand-refs'));
    const system = await current.get('builtin:ibm');
    expect(system.system.status).toBe('ready');
    expect(system.designMd).toContain('fontWeight: 300');
    expect(await readFile(oldPath, 'utf8')).toBe(legacy);
  });
  it('marks only successful fresh previews usable and retains failures as drafts', async () => {
    const detail = await library.create({ name: 'Preview' });
    const valid = (await call('validate', { id: detail.system.id })) as LibraryDesignSystemDetail;
    expect(valid.system.status).toBe('ready');
    expect(valid.system.thumbnail).toContain('data:image/png');
    preview.mockResolvedValueOnce({
      ok: false,
      reason: 'Broken preview',
      consoleErrors: [],
      assetErrors: [],
      metrics: { nodes: 0, width: 0, height: 0, loadMs: 0 },
    });
    const invalid = (await call('validate', { id: detail.system.id })) as LibraryDesignSystemDetail;
    expect(invalid.system.status).toBe('draft');
    expect(invalid.system.issues.join(' ')).toContain('Broken preview');
    expect(await readFile(path.join(detail.system.workspacePath, 'DESIGN.md'), 'utf8')).toContain(
      'Preview',
    );
  });
  it('rejects invalid payloads before filesystem actions', async () => {
    await expect(call('get', { id: '../escape' })).rejects.toThrow();
    await expect(call('create', { name: 42 })).rejects.toThrow();
  });
});
