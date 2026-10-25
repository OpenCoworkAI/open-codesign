import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pure Node workflow: production preload and main handlers run through an in-process Electron boundary.
const electronBoundary = vi.hoisted(() => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const state: {
    handlers: Map<string, Handler>;
    api: Record<string, unknown> | undefined;
    root: string;
    paths: Record<string, string>;
    electron: Record<string, unknown>;
    runtime: Record<string, unknown>;
    baseHandle: (channel: string, listener: Handler) => void;
    ipcMain: { handle: (channel: string, listener: Handler) => void };
    dialog: Record<string, unknown>;
    shell: Record<string, unknown>;
    clipboard: Record<string, unknown>;
  } = {
    handlers: new Map(),
    api: undefined,
    root: '',
    paths: {},
    electron: {},
    runtime: {},
    baseHandle: () => undefined,
    ipcMain: { handle: () => undefined },
    dialog: {},
    shell: {},
    clipboard: {},
  };
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = state.handlers.get(channel);
    if (!handler) throw new Error(`No IPC handler registered for ${channel}`);
    return await handler({ sender: null }, ...args);
  };
  state.baseHandle = (channel, listener) => {
    state.handlers.set(channel, listener);
  };
  state.ipcMain = { handle: state.baseHandle };
  state.dialog = {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  };
  state.shell = { openPath: async () => '' };
  state.clipboard = {};
  state.electron = {
    contextBridge: {
      exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
        state.api = api;
      },
    },
    ipcRenderer: { invoke },
    app: { getPath: (name: string) => state.paths[name] ?? state.root },
    ipcMain: state.ipcMain,
    dialog: state.dialog,
    shell: state.shell,
    clipboard: state.clipboard,
  };
  state.runtime = {
    app: state.electron['app'],
    ipcMain: state.ipcMain,
    dialog: state.dialog,
    shell: state.shell,
    clipboard: state.clipboard,
  };
  return state;
});

vi.mock('electron', () => electronBoundary.electron);
vi.mock('./electron-runtime', () => electronBoundary.runtime);
vi.mock('./logger', () => ({
  getLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }),
}));

import { DebugOperationClient, invokeCodesignOperationInPage } from '../debug/operation-client';
import { DEBUG_OPERATIONS } from '../debug/operations';
import { isBackgroundChannelAllowed, isBackgroundPayloadPathsAllowed } from './background-debug';
import { installBackgroundOperations } from './background-operations';
import { registerExporterIpc } from './exporter-ipc';
import { getDesign, initSnapshotsDb } from './snapshots-db';
import { registerSnapshotsIpc, registerWorkspaceIpc } from './snapshots-ipc';
import { normalizeWorkspacePath } from './workspace-path';

const temporaryRoots: string[] = [];

async function callOperation(
  client: DebugOperationClient,
  name: string,
  args: unknown[] = [],
): Promise<unknown> {
  const started = client.call(name, args);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const task = client.task(started.taskId);
    if (task.status === 'completed') return task.result;
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(`${name} ${task.status}: ${task.error?.message ?? 'unknown error'}`);
    }
  }
  throw new Error(`${name} did not finish within the test limit`);
}

function makeLargeJsxSource(targetBytes: number): string {
  const header =
    'const labels = { authorization: "sample-label", token: "Bearer example-label" };\nconst css = ":root{--color-token: #123456;}";\nexport default function App() {\n  return <main>完整文件 中文工作流</main>;\n}\n';
  const line = '// 用真实 preload 与业务 IPC 往返验证中文和换行。\n';
  const lineBytes = Buffer.byteLength(line, 'utf8');
  let repetitions = Math.floor((targetBytes - Buffer.byteLength(header, 'utf8')) / lineBytes);
  let source = header + line.repeat(repetitions);
  let remaining = targetBytes - Buffer.byteLength(source, 'utf8');
  while (remaining < 2) {
    repetitions -= 1;
    source = header + line.repeat(repetitions);
    remaining = targetBytes - Buffer.byteLength(source, 'utf8');
  }
  source += `//${'界'.repeat(Math.floor((remaining - 2) / 3))}${'x'.repeat((remaining - 2) % 3)}`;
  return source;
}

describe('background debug API business workflow', () => {
  beforeEach(async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-background-workflow-'));
    temporaryRoots.push(root);
    electronBoundary.root = root;
    electronBoundary.paths = {
      documents: path.join(root, 'documents'),
      downloads: path.join(root, 'downloads'),
      home: path.join(root, 'home'),
      userData: path.join(root, 'userData'),
    };
    electronBoundary.handlers.clear();
    electronBoundary.ipcMain.handle = electronBoundary.baseHandle;

    vi.stubGlobal('__CODESIGN_BACKGROUND_DEBUG__', true);
    if (!electronBoundary.api) await import('../preload/index');
    if (!electronBoundary.api) throw new Error('Preload did not expose window.codesign');
    Object.defineProperty(globalThis, 'codesign', {
      configurable: true,
      value: electronBoundary.api,
    });

    const rawHandle = electronBoundary.ipcMain.handle;
    electronBoundary.ipcMain.handle = (channel, listener) => {
      rawHandle(channel, async (event, ...args) => {
        const payload = args[0];
        if (
          !isBackgroundChannelAllowed(channel, payload, false, false, root) ||
          !isBackgroundPayloadPathsAllowed(root, payload)
        ) {
          throw new Error(`BACKGROUND_DEBUG_UNSUPPORTED: ${channel}`);
        }
        return await listener(event, ...args);
      });
    };

    installBackgroundOperations({
      root,
      ipcMain: electronBoundary.ipcMain,
      dialog: electronBoundary.dialog,
      shell: electronBoundary.shell,
      clipboard: electronBoundary.clipboard,
      record: () => undefined,
    });
    const db = initSnapshotsDb(path.join(root, 'store', 'design-store.json'));
    registerSnapshotsIpc(db);
    registerWorkspaceIpc(db, () => null);
    registerExporterIpc(() => null, db);
  });

  afterEach(async () => {
    Reflect.deleteProperty(globalThis, 'codesign');
    vi.unstubAllGlobals();
    for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it('creates, edits, reloads and exports a design through real business handlers', async () => {
    const root = electronBoundary.root;
    const catalog = DEBUG_OPERATIONS.filter(
      (operation) => operation.kind === 'call' && operation.mode === 'local',
    );
    const allowedNames = catalog.map((operation) => operation.name);
    const client = new DebugOperationClient(undefined, (operation, args) =>
      invokeCodesignOperationInPage({ name: operation.name, args, allowedNames }),
    );

    const workspacePath = path.join(root, 'documents', 'workflow');
    await mkdir(workspacePath, { recursive: true });
    const created = (await callOperation(client, 'snapshots.createDesign', [
      'Workflow design',
      workspacePath,
    ])) as { id: string; name: string; workspacePath: string };
    expect(created.workspacePath).toBe(normalizeWorkspacePath(workspacePath));

    const source =
      'const labels = { authorization: "sample-label" }; const css = ":root{--color-token: #123456;}"; export default function App() { return <main>Workflow</main>; }';
    await callOperation(client, 'files.write', [created.id, 'App.jsx', source]);
    await expect(readFile(path.join(workspacePath, 'App.jsx'), 'utf8')).resolves.toBe(source);
    await expect(
      callOperation(client, 'files.read', [created.id, 'App.jsx']),
    ).resolves.toMatchObject({
      path: 'App.jsx',
      content: source,
    });

    const reopenedDb = initSnapshotsDb(path.join(root, 'store', 'design-store.json'));
    expect(getDesign(reopenedDb, created.id)).toMatchObject({
      id: created.id,
      name: 'Workflow design',
      workspacePath: normalizeWorkspacePath(workspacePath),
    });

    const destination = path.join(workspacePath, 'result.html');
    await callOperation(client, 'test.exportDestination', [destination]);
    const exported = await callOperation(client, 'export', [
      {
        format: 'html',
        designId: created.id,
        sourcePath: 'App.jsx',
        artifactSource: source,
      },
    ]);
    expect(exported).toMatchObject({ status: 'saved', path: destination });
    const html = await readFile(destination, 'utf8');
    expect(html).toContain('Workflow');
    expect(html.toLowerCase()).toContain('<!doctype html>');
    await expect(
      callOperation(client, 'export', [
        {
          format: 'html',
          designId: created.id,
          sourcePath: 'App.jsx',
          artifactSource: source,
        },
      ]),
    ).resolves.toEqual({ status: 'cancelled' });
  });

  it('round-trips a 96 KiB Chinese JSX file and enforces expected-content writes', async () => {
    const root = electronBoundary.root;
    const catalog = DEBUG_OPERATIONS.filter(
      (operation) => operation.kind === 'call' && operation.mode === 'local',
    );
    const allowedNames = catalog.map((operation) => operation.name);
    const client = new DebugOperationClient(undefined, (operation, args) =>
      invokeCodesignOperationInPage({ name: operation.name, args, allowedNames }),
    );
    const workspacePath = path.join(root, 'fixtures', 'large-design');
    await mkdir(workspacePath, { recursive: true });
    const design = (await callOperation(client, 'snapshots.createDesign', [
      'Large JSX workflow',
      workspacePath,
    ])) as { id: string };
    const originalSource = 'export default function App() { return <main>初始版本</main>; }\n';
    const source = makeLargeJsxSource(96 * 1024);
    expect(Buffer.byteLength(source, 'utf8')).toBe(96 * 1024);
    expect(source).toContain('中文');
    expect(source).toContain('\n');

    await callOperation(client, 'files.write', [design.id, 'App.jsx', originalSource]);
    const written = (await callOperation(client, 'files.write', [
      design.id,
      'App.jsx',
      source,
      { expectedContent: originalSource },
    ])) as { content?: string; truncated?: boolean };
    expect(written.content).toBe(source);
    expect(written.truncated).toBeUndefined();

    const readBack = (await callOperation(client, 'files.read', [design.id, 'App.jsx'])) as {
      content?: string;
      truncated?: boolean;
    };
    expect(readBack.content).toBe(source);
    expect(readBack.truncated).toBeUndefined();
    await expect(readFile(path.join(workspacePath, 'App.jsx'), 'utf8')).resolves.toBe(source);

    const updatedSource = source.replace('完整文件', '修改文件');
    await expect(
      callOperation(client, 'files.write', [
        design.id,
        'App.jsx',
        updatedSource,
        { expectedContent: readBack.content },
      ]),
    ).resolves.toMatchObject({ content: updatedSource });

    await expect(
      callOperation(client, 'files.write', [
        design.id,
        'App.jsx',
        'export default function App() { return null; }',
        { expectedContent: originalSource },
      ]),
    ).rejects.toThrow('Workspace file changed before the tweak could be saved');
    await expect(readFile(path.join(workspacePath, 'App.jsx'), 'utf8')).resolves.toBe(
      updatedSource,
    );
  });

  it('recovers a missing export source and preserves edits made outside the app', async () => {
    const catalog = DEBUG_OPERATIONS.filter(
      (operation) => operation.kind === 'call' && operation.mode === 'local',
    );
    const allowedNames = catalog.map((operation) => operation.name);
    const client = new DebugOperationClient(undefined, (operation, args) =>
      invokeCodesignOperationInPage({ name: operation.name, args, allowedNames }),
    );
    const workspacePath = path.join(electronBoundary.root, 'recovery');
    await mkdir(workspacePath);
    const design = (await callOperation(client, 'snapshots.createDesign', [
      'Recovery workflow',
      workspacePath,
    ])) as { id: string };
    const destination = path.join(workspacePath, 'recovered.html');
    const original = 'export default function App() { return <main>Original draft</main>; }';
    const exportRequest = {
      format: 'html',
      designId: design.id,
      sourcePath: 'App.jsx',
      artifactSource: original,
    };
    await callOperation(client, 'test.exportDestination', [destination]);
    await expect(callOperation(client, 'export', [exportRequest])).rejects.toThrow(
      'Export source file not found: App.jsx',
    );
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await callOperation(client, 'files.write', [design.id, 'App.jsx', original]);
    const externalEdit = original.replace('Original draft', 'External edit preserved');
    await writeFile(path.join(workspacePath, 'App.jsx'), externalEdit);
    await expect(
      callOperation(client, 'files.write', [
        design.id,
        'App.jsx',
        original,
        {
          expectedContent: original,
        },
      ]),
    ).rejects.toThrow('Workspace file changed before the tweak could be saved');
    await expect(
      callOperation(client, 'files.read', [design.id, 'App.jsx']),
    ).resolves.toMatchObject({ content: externalEdit });

    // Validation failed before the save dialog; retry consumes the same pending destination.
    await expect(callOperation(client, 'export', [exportRequest])).resolves.toMatchObject({
      status: 'saved',
      path: destination,
    });
    const html = await readFile(destination, 'utf8');
    expect(html).toContain('External edit preserved');
    expect(html).not.toContain('Original draft');
    await expect(callOperation(client, 'export', [exportRequest])).resolves.toEqual({
      status: 'cancelled',
    });
    expect(client.summary()).toMatchObject({ active: 0, failed: 2 });
  });
});
