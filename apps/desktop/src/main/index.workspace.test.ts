import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../preload/index';
import { normalizeWorkspacePath } from './design-workspace';
import {
  __unsafeSetDesignWorkspaceForTest,
  createDesign,
  initInMemoryDb,
  updateDesignWorkspace,
  viewDesignFile,
} from './snapshots-db';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showErrorBox: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-empty-function
function BrowserWindowMock() {}

vi.mock('./electron-runtime', () => ({
  BrowserWindow: BrowserWindowMock,
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/open-codesign-tests';
      if (name === 'logs') return '/tmp/open-codesign-tests/logs';
      if (name === 'temp') return '/tmp';
      return '/tmp';
    }),
    setPath: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  clipboard: {
    writeText: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showErrorBox: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
    openPath: vi.fn(),
  },
}));

vi.mock('./storage-settings', () => ({
  getActiveStorageLocations: vi.fn(() => ({})),
  initStorageSettings: vi.fn(() => ({})),
}));

import { createRuntimeTextEditorFs } from './index';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_HEADER_DATA_URL = `data:image/png;base64,${PNG_HEADER.toString('base64')}`;

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function listFsUpdatedEvents(sendEvent: ReturnType<typeof vi.fn>): AgentStreamEvent[] {
  return sendEvent.mock.calls
    .map(([event]) => event as AgentStreamEvent)
    .filter((event) => event.type === 'fs_updated');
}

describe('createRuntimeTextEditorFs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects fs.create when a persisted design has no workspace binding', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspaceless');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-create-db-only',
      logger,
      previousHtml: null,
      sendEvent,
    });

    await expect(fs.create('nested/index.html', '<main>created</main>')).rejects.toThrow(
      'Design is not bound to a workspace',
    );

    expect(viewDesignFile(db, design.id, 'nested/index.html')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
    expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
  });

  it('seeds existing workspace text files into the runtime fs', () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Seeded Workspace');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-seeded-workspace',
      logger,
      previousHtml: '<main>stale preview</main>',
      initialFiles: [
        { file: 'index.html', contents: '<main>workspace source</main>' },
        { file: 'src/App.tsx', contents: 'export function App() { return <main />; }' },
      ],
      sendEvent,
    });

    expect(fs.view('index.html')?.content).toBe('<main>workspace source</main>');
    expect(fs.view('src/App.tsx')?.content).toContain('export function App');
    expect(fs.listDir('.')).toContain('src/App.tsx');
    expect(fs.listDir('src')).toEqual(['App.tsx']);
    expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
  });

  it('persists fs.create to db and writes disk when workspace is bound', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-create-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-create-workspace',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await fs.create('nested/index.html', '<main>created</main>');

      const diskPath = path.join(workspaceDir, 'nested/index.html');
      expect(viewDesignFile(db, design.id, 'nested/index.html')?.content).toBe(
        '<main>created</main>',
      );
      expect(readFileSync(diskPath, 'utf8')).toBe('<main>created</main>');
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(1);
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('writes generated data-url assets as binary files in a bound workspace', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Asset Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-asset-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-create-asset',
      logger,
      previousHtml: null,
      sendEvent,
    });
    const dataUrl = `\n ${PNG_HEADER_DATA_URL} \n`;

    try {
      await fs.create('assets/hero.png', dataUrl);

      const diskPath = path.join(workspaceDir, 'assets/hero.png');
      expect(readFileSync(diskPath)).toEqual(PNG_HEADER);
      expect(viewDesignFile(db, design.id, 'assets/hero.png')?.content).toBe(PNG_HEADER_DATA_URL);
      expect(listFsUpdatedEvents(sendEvent)).toEqual([
        expect.objectContaining({
          type: 'fs_updated',
          path: 'assets/hero.png',
          content: PNG_HEADER_DATA_URL,
        }),
      ]);
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('rejects malformed generated asset data URLs before reporting a file update', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Bad Asset Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-bad-asset-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-bad-asset',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await expect(fs.create('assets/hero.png', 'data:image/png;base64,%')).rejects.toMatchObject({
        code: 'ARTIFACT_PROTOCOL_INVALID',
      });

      expect(existsSync(path.join(workspaceDir, 'assets/hero.png'))).toBe(false);
      expect(viewDesignFile(db, design.id, 'assets/hero.png')).toBeNull();
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('rejects image data URLs whose bytes do not match the MIME type', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Wrong Signature Asset Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-wrong-signature-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-wrong-signature-asset',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await expect(
        fs.create('assets/hero.png', 'data:image/png;base64,aW1n'),
      ).rejects.toMatchObject({
        code: 'ARTIFACT_PROTOCOL_INVALID',
      });

      expect(existsSync(path.join(workspaceDir, 'assets/hero.png'))).toBe(false);
      expect(viewDesignFile(db, design.id, 'assets/hero.png')).toBeNull();
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('rejects unsupported generated asset image MIME types', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Unsupported Asset Mime Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-unsupported-mime-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-unsupported-mime-asset',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await expect(
        fs.create('assets/hero.png', 'data:image/svg+xml;base64,PHN2Zy8+'),
      ).rejects.toMatchObject({
        code: 'ARTIFACT_PROTOCOL_INVALID',
      });

      expect(existsSync(path.join(workspaceDir, 'assets/hero.png'))).toBe(false);
      expect(viewDesignFile(db, design.id, 'assets/hero.png')).toBeNull();
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('does not create a db row when bound workspace write-through fails', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-create-fail-');
    const workspaceFile = path.join(workspaceDir, 'occupied');
    writeFileSync(workspaceFile, 'occupied', 'utf8');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceFile));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-create-workspace-fail',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await expect(fs.create('nested/index.html', '<main>created</main>')).rejects.toThrow(
        'Workspace write-through failed for nested/index.html',
      );

      expect(viewDesignFile(db, design.id, 'nested/index.html')).toBeNull();
      expect(fs.view('nested/index.html')).toBeNull();
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('rejects corrupt empty workspace paths instead of writing relative to cwd', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Corrupt Workspace');
    __unsafeSetDesignWorkspaceForTest(db, design.id, '');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-corrupt-workspace',
      logger,
      previousHtml: null,
      sendEvent,
    });
    const probePath = `cwd-write-probe-${crypto.randomUUID()}.html`;
    const cwdProbe = path.join(process.cwd(), probePath);

    try {
      await expect(fs.create(probePath, '<main>bad</main>')).rejects.toThrow(
        'Workspace path must not be empty',
      );

      expect(existsSync(cwdProbe)).toBe(false);
      expect(viewDesignFile(db, design.id, probePath)).toBeNull();
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      rmSync(cwdProbe, { force: true });
    }
  });

  it('rejects runtime writes through symlinked workspace path segments', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Symlink Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-symlink-');
    const outsideDir = makeTempDir('ocd-runtime-symlink-outside-');
    try {
      try {
        symlinkSync(outsideDir, path.join(workspaceDir, 'assets'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }
      updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
      const sendEvent = vi.fn();
      const logger = { error: vi.fn() };
      const { fs } = createRuntimeTextEditorFs({
        db,
        designId: design.id,
        generationId: 'gen-symlink-workspace',
        logger,
        previousHtml: null,
        sendEvent,
      });

      await expect(fs.create('assets/leak.html', '<main>bad</main>')).rejects.toThrow(
        'Workspace write-through failed for assets/leak.html',
      );

      expect(existsSync(path.join(outsideDir, 'leak.html'))).toBe(false);
      expect(viewDesignFile(db, design.id, 'assets/leak.html')).toBeNull();
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
      cleanupDir(outsideDir);
    }
  });

  it('updates db and disk for fs.strReplace in a bound workspace', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-replace-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-replace-workspace',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await fs.create('index.html', '<main>before</main>');
      await fs.strReplace('index.html', 'before', 'after');

      const events = listFsUpdatedEvents(sendEvent);
      expect(viewDesignFile(db, design.id, 'index.html')?.content).toBe('<main>after</main>');
      expect(readFileSync(path.join(workspaceDir, 'index.html'), 'utf8')).toBe(
        '<main>after</main>',
      );
      expect(events).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({
        type: 'fs_updated',
        path: 'index.html',
        content: '<main>after</main>',
      });
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('does not advance in-memory content when bound workspace strReplace write-through fails', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-replace-fail-');
    const workspaceFile = path.join(workspaceDir, 'occupied');
    writeFileSync(workspaceFile, 'occupied', 'utf8');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-replace-workspace-fail',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await fs.create('index.html', '<main>before</main>');
      updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceFile));

      await expect(fs.strReplace('index.html', 'before', 'after')).rejects.toThrow(
        'Workspace write-through failed for index.html',
      );

      expect(viewDesignFile(db, design.id, 'index.html')).toBeNull();
      expect(fs.view('index.html')?.content).toBe('<main>before</main>');
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(1);
      expect(logger.error).toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('does not advance in-memory content when bound workspace insert write-through fails', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-insert-fail-');
    const workspaceFile = path.join(workspaceDir, 'occupied');
    writeFileSync(workspaceFile, 'occupied', 'utf8');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-insert-workspace-fail',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await fs.create('index.html', '<main>before</main>');
      updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceFile));

      await expect(fs.insert('index.html', 1, '<footer>after</footer>')).rejects.toThrow(
        'Workspace write-through failed for index.html',
      );

      expect(viewDesignFile(db, design.id, 'index.html')).toBeNull();
      expect(fs.view('index.html')?.content).toBe('<main>before</main>');
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(1);
      expect(logger.error).toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('updates db and disk for fs.insert in a bound workspace', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-insert-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-insert-workspace',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await fs.create('index.html', '<main>line1</main>');
      await fs.insert('index.html', 1, '<footer>tail</footer>');

      const events = listFsUpdatedEvents(sendEvent);
      expect(viewDesignFile(db, design.id, 'index.html')?.content).toBe(
        '<main>line1</main>\n<footer>tail</footer>',
      );
      expect(readFileSync(path.join(workspaceDir, 'index.html'), 'utf8')).toBe(
        '<main>line1</main>\n<footer>tail</footer>',
      );
      expect(events).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({
        type: 'fs_updated',
        path: 'index.html',
        content: '<main>line1</main>\n<footer>tail</footer>',
      });
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('rejects fs.insert for files that do not exist', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-insert-missing-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-insert-missing',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await expect(fs.insert('missing.html', 0, '<main>nope</main>')).rejects.toThrow(
        'File not found: missing.html',
      );

      expect(viewDesignFile(db, design.id, 'missing.html')).toBeNull();
      expect(existsSync(path.join(workspaceDir, 'missing.html'))).toBe(false);
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('rejects mutations for persisted designs whose workspacePath is null', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspaceless');
    const workspaceDir = makeTempDir('ocd-runtime-null-workspace-');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-null-workspace',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await expect(fs.create('nested/index.html', '<main>start</main>')).rejects.toThrow(
        'Design is not bound to a workspace',
      );

      expect(viewDesignFile(db, design.id, 'nested/index.html')).toBeNull();
      expect(existsSync(path.join(workspaceDir, 'nested/index.html'))).toBe(false);
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('emits fs_updated for anonymous mutations without db persistence', async () => {
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = createRuntimeTextEditorFs({
      db: initInMemoryDb(),
      designId: null,
      generationId: 'gen-anon',
      logger,
      previousHtml: null,
      sendEvent,
    });

    await fs.create('index.html', '<main>start</main>');
    await fs.strReplace('index.html', 'start', 'middle');
    await fs.insert('index.html', 1, '<footer>end</footer>');

    expect(listFsUpdatedEvents(sendEvent)).toHaveLength(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
