import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SourceEditApplyResultV1, SourceEditInspectResultV1 } from '@open-codesign/shared';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesign, initInMemoryDb, listSnapshots, updateDesignWorkspace } from './snapshots-db';
import { registerSourceEditBusyCheck, registerSourceEditsIpc } from './source-edits-ipc';
import { runWithWorkspaceRenameQueue } from './workspace-path-lock';
import { readWorkspaceFileAt } from './workspace-reader';

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
vi.mock('./electron-runtime', () => ({
  ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) },
}));
vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

const original = 'function App() { return <main><h1 title="hello">Original</h1></main>; }';
let root: string;
let db: ReturnType<typeof initInMemoryDb>;
let designId: string;
let busy: boolean;
let unregister: () => void;
function invoke(kind: 'inspect' | 'apply', raw: unknown, event: unknown = null) {
  const handler = handlers.get(`codesign:source-edits:v1:${kind}`);
  if (!handler) throw new Error('No handler');
  return handler(event, raw);
}
function inspect(id = designId, file = 'App.jsx', expectedContent = original) {
  return invoke('inspect', { schemaVersion: 1, designId: id, path: file, expectedContent }).then(
    (result) => SourceEditInspectResultV1.parse(result),
  );
}
async function request(id = designId) {
  const result = await inspect(id);
  if (result.status !== 'ready') throw new Error(result.message);
  const target = result.targets.find((target) => target.tagName === 'h1');
  if (!target) throw new Error('Missing h1');
  return {
    schemaVersion: 1 as const,
    designId: id,
    path: 'App.jsx',
    expectedSourceHash: result.sourceHash,
    previewRevision: 'preview-1',
    targetId: target.id,
    operation: { kind: 'set-text' as const, value: 'Edited' },
    scope: 'source-definition' as const,
  };
}
beforeEach(async () => {
  handlers.clear();
  busy = false;
  root = await mkdtemp(path.join(tmpdir(), 'codesign-source-ipc-'));
  await writeFile(path.join(root, 'App.jsx'), original);
  db = initInMemoryDb();
  designId = createDesign(db, 'Source edits').id;
  updateDesignWorkspace(db, designId, root);
  unregister = registerSourceEditBusyCheck(() => busy);
  registerSourceEditsIpc(db, () => null);
});
afterEach(async () => {
  unregister();
  await rm(root, { recursive: true, force: true });
});

describe('deterministic source edits IPC', () => {
  it('persists explicit source selection beside effects while retaining stale protection', async () => {
    const content = original.replace(
      'return <main>',
      'React.useEffect(() => { document.title = "Page"; }, []); return <main>',
    );
    await writeFile(path.join(root, 'App.jsx'), content);
    expect(await inspect(designId, 'App.jsx', content)).toMatchObject({
      status: 'rejected',
      reason: 'unsafe-source',
    });
    const result = SourceEditInspectResultV1.parse(
      await invoke('inspect', {
        schemaVersion: 1,
        designId,
        path: 'App.jsx',
        expectedContent: content,
        selectionMode: 'source',
      }),
    );
    if (result.status !== 'ready') throw new Error(result.message);
    const target = result.targets.find((item) => item.tagName === 'h1');
    if (!target) throw new Error('Missing heading');
    const input = {
      schemaVersion: 1,
      designId,
      path: 'App.jsx',
      selectionMode: 'source',
      expectedSourceHash: result.sourceHash,
      targetId: target.id,
      previewRevision: 'source-list-1',
      scope: 'source-definition',
      operation: { kind: 'set-text', value: 'Source selected' },
    };
    expect(await invoke('apply', input)).toMatchObject({ status: 'applied' });
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(
      content.replace('>Original<', '>{"Source selected"}<'),
    );
    expect(await invoke('apply', input)).toMatchObject({
      status: 'rejected',
      reason: 'stale-source',
    });
  });
  it('reads actual workspace, applies one AST patch and creates no snapshots', async () => {
    const input = await request();
    const result = SourceEditApplyResultV1.parse(await invoke('apply', input));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(result.content);
    expect(result.content).toContain('{"Edited"}');
    expect(result.content).toContain('title="hello"');
    expect(result.previewRevision).toBe(input.previewRevision);
    expect(listSnapshots(db, designId)).toEqual([]);
    expect(await readdir(root)).toEqual(['App.jsx']);
  });
  it('rejects stale inspect and apply without overwriting an external version', async () => {
    const input = await request();
    await writeFile(path.join(root, 'App.jsx'), 'external');
    expect(await inspect()).toMatchObject({ status: 'rejected', reason: 'stale-source' });
    expect(await invoke('apply', input)).toMatchObject({
      status: 'rejected',
      reason: 'stale-source',
    });
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe('external');
  });
  it('runtime-validates schema, operations, scope and does not trust extra range fields', async () => {
    const input = await request();
    for (const changed of [
      { ...input, schemaVersion: 2 },
      { ...input, scope: 'instance' },
      { ...input, operation: { kind: 'set-attribute', name: 'onClick', value: 'evil()' } },
      { ...input, start: 0, end: original.length },
    ]) {
      expect(await invoke('apply', changed)).toMatchObject({
        status: 'rejected',
        reason: 'invalid-input',
      });
    }
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(original);
  });
  it('rejects missing, hidden, escaping and non-JSX files instead of falling back', async () => {
    await writeFile(path.join(root, 'index.html'), original);
    for (const file of ['Missing.jsx', '.private.jsx', '../outside.jsx', 'index.html']) {
      expect(await inspect(designId, file)).toMatchObject({ status: 'rejected' });
    }
    const unbound = createDesign(db, 'Unbound');
    expect(await inspect(unbound.id)).toMatchObject({
      status: 'rejected',
      reason: 'workspace-required',
    });
  });
  it('rejects traversal through a linked directory', async () => {
    const external = await mkdtemp(path.join(tmpdir(), 'codesign-source-external-'));
    try {
      await writeFile(path.join(external, 'App.jsx'), original);
      await symlink(
        external,
        path.join(root, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      expect(await inspect(designId, 'linked/App.jsx')).toMatchObject({ status: 'rejected' });
      expect(await readFile(path.join(external, 'App.jsx'), 'utf8')).toBe(original);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
  it('uses real busy checks and cancels when the sender was destroyed', async () => {
    const input = await request();
    busy = true;
    expect(await invoke('apply', input)).toMatchObject({ status: 'rejected', reason: 'busy' });
    busy = false;
    expect(await invoke('apply', input, { sender: { isDestroyed: () => true } })).toMatchObject({
      status: 'rejected',
      reason: 'cancelled',
    });
    unregister();
    expect(await invoke('apply', input)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
    });
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(original);
  });
  it('rejects generation starting while a staged edit is being prepared', async () => {
    const input = await request();
    let checks = 0;
    unregister();
    unregister = registerSourceEditBusyCheck(() => ++checks > 1);
    expect(await invoke('apply', input)).toMatchObject({ status: 'rejected', reason: 'busy' });
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(original);
    expect(await readdir(root)).toEqual(['App.jsx']);
  });
  it('rejects invalid UTF8 and preserves BOM bytes rather than silently transcoding', async () => {
    await writeFile(path.join(root, 'App.jsx'), Buffer.from([0xff, 0xfe, 0x61]));
    expect(await inspect()).toMatchObject({ status: 'rejected' });
    expect(await readFile(path.join(root, 'App.jsx'))).toEqual(Buffer.from([0xff, 0xfe, 0x61]));
    await writeFile(path.join(root, 'App.jsx'), String.fromCharCode(0xfeff) + original);
    expect(await inspect()).toMatchObject({ status: 'rejected', reason: 'stale-source' });
  });
  it.each([
    'App.jsx',
    'App.tsx',
  ])('preserves BOM across workspace read, inspect, apply and refreshed %s source', async (name) => {
    const source = String.fromCharCode(0xfeff) + original;
    const file = path.join(root, name);
    await writeFile(file, source);
    // This is the reader used by files.read, not a separate engine-only string.
    const preview = await readWorkspaceFileAt(root, name);
    const inspected = await inspect(designId, name, preview.content);
    expect(inspected.status).toBe('ready');
    if (inspected.status !== 'ready') throw new Error(inspected.message);
    expect(inspected.sourceHash).toBe(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    );
    const target = inspected.targets.find((entry) => entry.tagName === 'h1');
    if (!target) throw new Error('Missing BOM source target');
    const result = SourceEditApplyResultV1.parse(
      await invoke('apply', {
        schemaVersion: 1,
        designId,
        path: name,
        expectedSourceHash: inspected.sourceHash,
        previewRevision: 'bom-preview',
        targetId: target.id,
        operation: { kind: 'set-text', value: 'BOM edited' },
        scope: 'source-definition',
      }),
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') throw new Error(result.message);
    expect(result.content.charCodeAt(0)).toBe(0xfeff);
    expect(result.content).toBe(
      source.slice(0, result.patch.start) +
        result.patch.replacement +
        source.slice(result.patch.end),
    );
    expect(await readFile(file)).toEqual(Buffer.from(result.content, 'utf8'));
    const refreshed = await readWorkspaceFileAt(root, name);
    expect(refreshed.content).toBe(result.content);
    expect(await inspect(designId, name, refreshed.content)).toMatchObject({
      status: 'ready',
      sourceHash: result.sourceHash,
    });
  });
  it('serializes two designs sharing one source and rejects the second stale patch', async () => {
    const other = createDesign(db, 'Shared');
    updateDesignWorkspace(db, other.id, root);
    const first = await request();
    const second = await request(other.id);
    const results = await Promise.all([invoke('apply', first), invoke('apply', second)]);
    expect(
      results.filter((result) => (result as { status: string }).status === 'applied'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => (result as { status: string }).status === 'rejected'),
    ).toHaveLength(1);
  });
  it('waits for a workspace lease and rechecks the new source instead of using an old root', async () => {
    const input = await request();
    const next = path.join(root, 'next');
    await mkdir(next);
    await writeFile(path.join(next, 'App.jsx'), 'new workspace source');
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const rename = runWithWorkspaceRenameQueue(designId, async () => {
      entered();
      await gate;
      updateDesignWorkspace(db, designId, next);
    });
    await started;
    const pending = invoke('apply', input);
    release();
    await rename;
    expect(await pending).toMatchObject({ status: 'rejected', reason: 'stale-source' });
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toBe(original);
    expect(await readFile(path.join(next, 'App.jsx'), 'utf8')).toBe('new workspace source');
  });
  it('returns applied after commit even if refresh notification fails', async () => {
    const input = await request();
    registerSourceEditsIpc(
      db,
      () =>
        ({
          isDestroyed: () => false,
          webContents: {
            send: () => {
              throw new Error('notification failed');
            },
          },
        }) as unknown as BrowserWindow,
    );
    expect(await invoke('apply', input)).toMatchObject({
      status: 'applied',
      previewRevision: input.previewRevision,
      warnings: [expect.stringContaining('source was saved')],
    });
    expect(await readFile(path.join(root, 'App.jsx'), 'utf8')).toContain('Edited');
  });
});
