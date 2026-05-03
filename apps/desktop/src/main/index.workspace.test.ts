import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStreamEvent } from '../preload/index';
import { normalizeWorkspacePath } from './design-workspace';
import {
  createDesign,
  initInMemoryDb,
  updateDesignWorkspace,
  viewDesignFile,
} from './snapshots-db';
import { WORKSPACE_WALK_MAX_FILES } from './workspace-walk';

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

import {
  WORKSPACE_SEED_MAX_TOTAL_BYTES,
  createRuntimeTextEditorFs,
  seedFsMapFromWorkspace,
} from './index';

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

  it('persists fs.create to db without writing disk when workspace is absent', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspaceless');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-create-db-only',
      logger,
      previousHtml: null,
      sendEvent,
    });

    await fs.create('nested/index.html', '<main>created</main>');

    expect(viewDesignFile(db, design.id, 'nested/index.html')?.content).toBe(
      '<main>created</main>',
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(listFsUpdatedEvents(sendEvent)).toHaveLength(1);
  });

  it('persists fs.create to db and writes disk when workspace is bound', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-create-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
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

  it('does not create a db row when bound workspace write-through fails', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-create-fail-');
    const workspaceFile = path.join(workspaceDir, 'occupied');
    writeFileSync(workspaceFile, 'occupied', 'utf8');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceFile));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
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

  it('updates db and disk for fs.strReplace in a bound workspace', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-replace-');
    updateDesignWorkspace(db, design.id, normalizeWorkspacePath(workspaceDir));
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
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

  it('does not advance db content when bound workspace strReplace write-through fails', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-replace-fail-');
    const workspaceFile = path.join(workspaceDir, 'occupied');
    writeFileSync(workspaceFile, 'occupied', 'utf8');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
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

      expect(viewDesignFile(db, design.id, 'index.html')?.content).toBe('<main>before</main>');
      expect(fs.view('index.html')?.content).toBe('<main>before</main>');
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(1);
      expect(logger.error).toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('does not advance db content when bound workspace insert write-through fails', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspace');
    const workspaceDir = makeTempDir('ocd-runtime-insert-fail-');
    const workspaceFile = path.join(workspaceDir, 'occupied');
    writeFileSync(workspaceFile, 'occupied', 'utf8');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
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

      expect(viewDesignFile(db, design.id, 'index.html')?.content).toBe('<main>before</main>');
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
    const { fs } = await createRuntimeTextEditorFs({
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

  it('skips disk writes for all mutations when workspacePath is null', async () => {
    const db = initInMemoryDb();
    const design = createDesign(db, 'Workspaceless');
    const workspaceDir = makeTempDir('ocd-runtime-null-workspace-');
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
      db,
      designId: design.id,
      generationId: 'gen-null-workspace',
      logger,
      previousHtml: null,
      sendEvent,
    });

    try {
      await fs.create('nested/index.html', '<main>start</main>');
      await fs.strReplace('nested/index.html', 'start', 'middle');
      await fs.insert('nested/index.html', 1, '<footer>end</footer>');

      expect(viewDesignFile(db, design.id, 'nested/index.html')?.content).toBe(
        '<main>middle</main>\n<footer>end</footer>',
      );
      expect(existsSync(path.join(workspaceDir, 'nested/index.html'))).toBe(false);
      expect(listFsUpdatedEvents(sendEvent)).toHaveLength(3);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('emits fs_updated for anonymous mutations without db persistence', async () => {
    const sendEvent = vi.fn();
    const logger = { error: vi.fn() };
    const { fs } = await createRuntimeTextEditorFs({
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

describe('seedFsMapFromWorkspace', () => {
  it('truncates after the workspace file-count cap', async () => {
    const workspaceDir = makeTempDir('ocd-runtime-seed-file-cap-');
    const fsMap = new Map<string, string>();
    const logger = { error: vi.fn(), info: vi.fn() };

    try {
      for (let i = 0; i < WORKSPACE_WALK_MAX_FILES + 1; i += 1) {
        writeFileSync(path.join(workspaceDir, `${String(i).padStart(3, '0')}.html`), 'ok', 'utf8');
      }

      const result = await seedFsMapFromWorkspace(workspaceDir, fsMap, logger);

      expect(result.filesLoaded).toBe(WORKSPACE_WALK_MAX_FILES);
      expect(result.filesSkipped).toBe(0);
      expect(result.bytesLoaded).toBe(WORKSPACE_WALK_MAX_FILES * 2);
      expect(result.truncated).toBe(true);
      expect(fsMap.size).toBe(WORKSPACE_WALK_MAX_FILES);
      expect(fsMap.has('500.html')).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });

  it('caps seeded workspace text by per-file bytes and total bytes', async () => {
    const workspaceDir = makeTempDir('ocd-runtime-seed-caps-');
    const fsMap = new Map<string, string>();
    const logger = { error: vi.fn(), info: vi.fn() };

    try {
      writeFileSync(path.join(workspaceDir, '0-oversize.json'), 'o'.repeat(1_000_001), 'utf8');
      writeFileSync(path.join(workspaceDir, 'a.html'), 'a'.repeat(1_000_000), 'utf8');
      writeFileSync(path.join(workspaceDir, 'b.css'), 'b'.repeat(1_000_000), 'utf8');
      writeFileSync(path.join(workspaceDir, 'c.js'), 'c'.repeat(1_000_000), 'utf8');
      writeFileSync(path.join(workspaceDir, 'd.ts'), 'd'.repeat(1_000_000), 'utf8');
      writeFileSync(path.join(workspaceDir, 'e.md'), 'e'.repeat(1_000_000), 'utf8');
      writeFileSync(path.join(workspaceDir, 'f.txt'), 'f', 'utf8');
      mkdirSync(path.join(workspaceDir, 'node_modules'));
      writeFileSync(path.join(workspaceDir, 'node_modules', 'ignored.js'), 'ignored', 'utf8');

      const result = await seedFsMapFromWorkspace(workspaceDir, fsMap, logger);

      expect(result).toEqual({
        filesLoaded: 5,
        filesSkipped: 2,
        bytesLoaded: WORKSPACE_SEED_MAX_TOTAL_BYTES,
        truncated: true,
      });
      expect(fsMap.size).toBe(5);
      expect(fsMap.has('f.txt')).toBe(false);
      expect(fsMap.has('0-oversize.json')).toBe(false);
      expect(fsMap.has('node_modules/ignored.js')).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      cleanupDir(workspaceDir);
    }
  });
});
