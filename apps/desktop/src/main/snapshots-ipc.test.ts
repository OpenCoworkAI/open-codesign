/**
 * Unit tests for snapshots-ipc.ts.
 *
 * Mocks electron-runtime so ipcMain.handle() can be intercepted, then
 * calls the registered handlers directly with an in-memory DB.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Collect registered handlers so tests can invoke them directly.
const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();
const mockPaths = vi.hoisted(() => ({ userData: '', documents: '' }));
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_HEADER_DATA_URL = `data:image/png;base64,${PNG_HEADER.toString('base64')}`;

vi.mock('./electron-runtime', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return mockPaths.userData;
      if (name === 'documents') return mockPaths.documents;
      return mockPaths.userData;
    }),
  },
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, raw: unknown) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./design-workspace', () => ({
  bindWorkspace: vi.fn(),
  openWorkspaceFolder: vi.fn(),
  checkWorkspaceFolderExists: vi.fn(),
}));

import { bindWorkspace, checkWorkspaceFolderExists, openWorkspaceFolder } from './design-workspace';
import { dialog } from './electron-runtime';
import {
  clearDesignWorkspace,
  createDesign,
  createSnapshot,
  initInMemoryDb,
  updateDesignWorkspace,
  viewDesignFile,
} from './snapshots-db';
import {
  registerSnapshotsIpc,
  registerSnapshotsUnavailableIpc,
  registerWorkspaceIpc,
  SNAPSHOTS_CHANNELS_V1,
} from './snapshots-ipc';

function call(channel: string, raw: unknown): unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler for channel: ${channel}`);
  return fn(null, raw);
}

async function callAsync(channel: string, raw: unknown): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler for channel: ${channel}`);
  return fn(null, raw);
}

// All snapshots:v1:* object payloads carry schemaVersion: 1; this helper keeps
// tests focused on the field under test rather than repeating the version field.
function v1<T extends object>(payload: T): T & { schemaVersion: 1 } {
  return { schemaVersion: 1, ...payload };
}

let db: ReturnType<typeof initInMemoryDb>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'codesign-snapshots-ipc-'));
  mockPaths.userData = path.join(tempRoot, 'user-data');
  mockPaths.documents = path.join(tempRoot, 'documents');
  handlers.clear();
  db = initInMemoryDb();
  vi.mocked(bindWorkspace).mockImplementation(async (targetDb, designId, workspacePath) => {
    const updated =
      workspacePath === null
        ? clearDesignWorkspace(targetDb, designId)
        : updateDesignWorkspace(targetDb, designId, workspacePath);
    if (updated === null) throw new Error('Design not found');
    return updated;
  });
  registerSnapshotsIpc(db);
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  registerWorkspaceIpc(db, () => ({}) as any);
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// snapshots:v1:list-designs
// ---------------------------------------------------------------------------

describe('snapshots:v1:list-designs', () => {
  it('returns an empty array when no designs exist', () => {
    const result = call('snapshots:v1:list-designs', v1({}));
    expect(result).toEqual([]);
  });

  it('returns created designs', () => {
    createDesign(db, 'Test design');
    const result = call('snapshots:v1:list-designs', v1({})) as unknown[];
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// chat:v1:* session JSONL persistence
// ---------------------------------------------------------------------------

describe('chat:v1 session persistence', () => {
  it('persists user chat rows to per-design session JSONL and reloads them', () => {
    const design = createDesign(db, 'Chat design');
    updateDesignWorkspace(db, design.id, path.join(tempRoot, 'workspace'));

    const appended = call(
      'chat:v1:append',
      v1({
        designId: design.id,
        kind: 'user',
        payload: { text: 'build a dashboard' },
      }),
    ) as Record<string, unknown>;

    expect(appended).toMatchObject({
      designId: design.id,
      seq: 0,
      kind: 'user',
      payload: { text: 'build a dashboard' },
    });

    const sessionFile = path.join(mockPaths.userData, 'sessions', `${design.id}.jsonl`);
    expect(existsSync(sessionFile)).toBe(true);
    const sessionText = readFileSync(sessionFile, 'utf8');
    expect(sessionText).toContain('"type":"session"');
    expect(sessionText).toContain('"customType":"open-codesign.chat.message"');
    expect(sessionText).toContain('build a dashboard');

    const sqliteCount = db
      .prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE design_id = ?')
      .get(design.id) as { n: number };
    expect(sqliteCount.n).toBe(0);

    handlers.clear();
    registerSnapshotsIpc(db);

    const rows = call('chat:v1:list', v1({ designId: design.id })) as Array<{
      kind: string;
      payload: { text?: string };
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'user',
      payload: { text: 'build a dashboard' },
    });
  });

  it('seeds legacy snapshots into session JSONL once', () => {
    const design = createDesign(db, 'Snapshot-backed design');
    updateDesignWorkspace(db, design.id, path.join(tempRoot, 'workspace'));
    createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: 'make a product card',
      artifactType: 'html',
      artifactSource: '<html>card</html>',
    });

    expect(call('chat:v1:seed-from-snapshots', v1({ designId: design.id }))).toEqual({
      inserted: 2,
    });
    expect(call('chat:v1:seed-from-snapshots', v1({ designId: design.id }))).toEqual({
      inserted: 0,
    });

    const files = readdirSync(path.join(mockPaths.userData, 'sessions'));
    expect(files).toEqual([`${design.id}.jsonl`]);

    const rows = call('chat:v1:list', v1({ designId: design.id })) as Array<{
      kind: string;
      payload: { text?: string };
    }>;
    expect(rows.map((row) => row.kind)).toEqual(['user', 'artifact_delivered']);
    expect(rows[0]?.payload.text).toBe('make a product card');
  });

  it('replays tool-call status updates without mutating prior JSONL entries', () => {
    const design = createDesign(db, 'Tool design');
    updateDesignWorkspace(db, design.id, path.join(tempRoot, 'workspace'));
    const row = call(
      'chat:v1:append',
      v1({
        designId: design.id,
        kind: 'tool_call',
        payload: {
          toolName: 'text_editor',
          args: {},
          status: 'running',
          startedAt: '2026-04-27T00:00:00.000Z',
          verbGroup: 'Working',
        },
      }),
    ) as { seq: number };

    expect(
      call(
        'chat:v1:update-tool-status',
        v1({
          designId: design.id,
          seq: row.seq,
          status: 'done',
          result: { ok: true },
          durationMs: 42,
        }),
      ),
    ).toEqual({ ok: true });

    const rows = call('chat:v1:list', v1({ designId: design.id })) as Array<{
      payload: { status?: string; result?: unknown; durationMs?: number };
    }>;
    expect(rows[0]?.payload).toMatchObject({
      status: 'done',
      result: { ok: true },
      durationMs: 42,
    });

    const sessionFile = path.join(mockPaths.userData, 'sessions', `${design.id}.jsonl`);
    const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
    expect(lines.filter((line) => line.includes('open-codesign.chat.message'))).toHaveLength(1);
    expect(lines.filter((line) => line.includes('open-codesign.chat.tool_status'))).toHaveLength(1);
  });

  it('throws when an Open CoDesign chat JSONL entry is malformed', () => {
    const design = createDesign(db, 'Corrupt chat design');
    updateDesignWorkspace(db, design.id, path.join(tempRoot, 'workspace'));
    call(
      'chat:v1:append',
      v1({
        designId: design.id,
        kind: 'user',
        payload: { text: 'hello' },
      }),
    );
    const sessionFile = path.join(mockPaths.userData, 'sessions', `${design.id}.jsonl`);
    const corruptEntry = {
      type: 'custom',
      customType: 'open-codesign.chat.message',
      data: { schemaVersion: 1, id: 'bad', seq: 1, kind: 'user', snapshotId: null },
      timestamp: '2026-04-27T00:00:00.000Z',
    };
    writeFileSync(
      sessionFile,
      `${readFileSync(sessionFile, 'utf8')}${JSON.stringify(corruptEntry)}\n`,
    );

    expect(() => call('chat:v1:list', v1({ designId: design.id }))).toThrow(CodesignError);
  });

  it('throws when a tool-status JSONL entry references a missing message sequence', () => {
    const design = createDesign(db, 'Orphan tool status design');
    updateDesignWorkspace(db, design.id, path.join(tempRoot, 'workspace'));
    call(
      'chat:v1:append',
      v1({
        designId: design.id,
        kind: 'user',
        payload: { text: 'hello' },
      }),
    );
    const sessionFile = path.join(mockPaths.userData, 'sessions', `${design.id}.jsonl`);
    const orphanEntry = {
      type: 'custom',
      customType: 'open-codesign.chat.tool_status',
      data: { schemaVersion: 1, seq: 99, status: 'done' },
      timestamp: '2026-04-27T00:00:00.000Z',
    };
    writeFileSync(
      sessionFile,
      `${readFileSync(sessionFile, 'utf8')}${JSON.stringify(orphanEntry)}\n`,
    );

    expect(() => call('chat:v1:list', v1({ designId: design.id }))).toThrow(CodesignError);
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:list
// ---------------------------------------------------------------------------

describe('snapshots:v1:list', () => {
  it('returns snapshots for a design', () => {
    const design = createDesign(db);
    createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    const result = call('snapshots:v1:list', v1({ designId: design.id })) as unknown[];
    expect(result).toHaveLength(1);
  });

  it('rejects a missing designId with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:list', v1({}))).toThrow(CodesignError);
    try {
      call('snapshots:v1:list', v1({}));
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects a non-object payload with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:list', null)).toThrow(CodesignError);
    try {
      call('snapshots:v1:list', null);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:create
// ---------------------------------------------------------------------------

describe('snapshots:v1:create', () => {
  it('creates and returns a snapshot', () => {
    const design = createDesign(db);
    const input = v1({
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: 'Build a hero section',
      artifactType: 'html',
      artifactSource: '<html>hero</html>',
    });
    const result = call('snapshots:v1:create', input) as Record<string, unknown>;
    expect(result['id']).toBeTruthy();
    expect(result['designId']).toBe(design.id);
    expect(result['type']).toBe('initial');
  });

  it('rejects bad payload (missing designId) with IPC_BAD_INPUT', () => {
    const bad = v1({
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    expect(() => call('snapshots:v1:create', bad)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', bad);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects invalid type with IPC_BAD_INPUT', () => {
    const bad = v1({
      designId: 'some-id',
      parentId: null,
      type: 'invalid-type',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    expect(() => call('snapshots:v1:create', bad)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', bad);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects invalid artifactType with IPC_BAD_INPUT', () => {
    const bad = v1({
      designId: 'some-id',
      parentId: null,
      type: 'edit',
      prompt: null,
      artifactType: 'pptx',
      artifactSource: '<html/>',
    });
    expect(() => call('snapshots:v1:create', bad)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', bad);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects null payload with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:create', null)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', null);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects a parentId that does not exist with IPC_BAD_INPUT', () => {
    const design = createDesign(db);
    const bad = v1({
      designId: design.id,
      parentId: 'no-such-snapshot',
      type: 'edit',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    expect(() => call('snapshots:v1:create', bad)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', bad);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects a parentId from a different design with IPC_BAD_INPUT', () => {
    const designA = createDesign(db);
    const designB = createDesign(db);
    const parentInA = createSnapshot(db, {
      designId: designA.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    const bad = v1({
      designId: designB.id,
      parentId: parentInA.id,
      type: 'edit',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    expect(() => call('snapshots:v1:create', bad)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', bad);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:create-design
// ---------------------------------------------------------------------------

describe('snapshots:v1:create-design', () => {
  it('creates a design with the trimmed name', async () => {
    const result = (await callAsync(
      'snapshots:v1:create-design',
      v1({ name: '  My design  ' }),
    )) as Record<string, unknown>;
    expect(result['name']).toBe('My design');
    expect(typeof result['id']).toBe('string');
  });

  it('rejects undefined with IPC_BAD_INPUT (no silent default)', async () => {
    await expect(callAsync('snapshots:v1:create-design', undefined)).rejects.toThrow(CodesignError);
    try {
      await callAsync('snapshots:v1:create-design', undefined);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects an empty / whitespace-only name with IPC_BAD_INPUT', async () => {
    await expect(callAsync('snapshots:v1:create-design', v1({ name: '   ' }))).rejects.toThrow(
      CodesignError,
    );
    try {
      await callAsync('snapshots:v1:create-design', v1({ name: '' }));
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects a non-string name with IPC_BAD_INPUT', async () => {
    await expect(callAsync('snapshots:v1:create-design', v1({ name: 42 }))).rejects.toThrow(
      CodesignError,
    );
    try {
      await callAsync('snapshots:v1:create-design', v1({ name: { wrong: true } }));
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:get
// ---------------------------------------------------------------------------

describe('snapshots:v1:get', () => {
  it('returns null for an unknown id', () => {
    const result = call('snapshots:v1:get', v1({ id: 'ghost' }));
    expect(result).toBeNull();
  });

  it('returns the snapshot by id', () => {
    const design = createDesign(db);
    const snap = createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    const result = call('snapshots:v1:get', v1({ id: snap.id })) as Record<string, unknown>;
    expect(result['id']).toBe(snap.id);
  });

  it('rejects missing id with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:get', v1({}))).toThrow(CodesignError);
    try {
      call('snapshots:v1:get', v1({}));
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:delete
// ---------------------------------------------------------------------------

describe('snapshots:v1:delete', () => {
  it('deletes a snapshot', () => {
    const design = createDesign(db);
    const snap = createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    call('snapshots:v1:delete', v1({ id: snap.id }));
    const result = call('snapshots:v1:get', v1({ id: snap.id }));
    expect(result).toBeNull();
  });

  it('rejects missing id with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:delete', v1({}))).toThrow(CodesignError);
    try {
      call('snapshots:v1:delete', v1({}));
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// schemaVersion gating
//
// Every snapshots:v1:* object payload must carry schemaVersion: 1. Older or
// future callers that omit it (or send a different value) get IPC_BAD_INPUT
// rather than a silent mis-parse, so handler revisions can break cleanly.
// ---------------------------------------------------------------------------

describe('schemaVersion gating', () => {
  const channelsAndSamples: Array<[string, Record<string, unknown>]> = [
    ['snapshots:v1:list-designs', {}],
    ['snapshots:v1:list', { designId: 'd' }],
    ['snapshots:v1:get', { id: 'x' }],
    ['snapshots:v1:delete', { id: 'x' }],
    ['snapshots:v1:create-design', { name: 'd' }],
    ['snapshots:v1:get-design', { id: 'x' }],
    ['snapshots:v1:rename-design', { id: 'x', name: 'n' }],
    ['snapshots:v1:set-thumbnail', { id: 'x', thumbnailText: null }],
    ['snapshots:v1:soft-delete-design', { id: 'x' }],
    ['snapshots:v1:duplicate-design', { id: 'x', name: 'n' }],
    ['snapshots:v1:workspace:check', { designId: 'x' }],
    [
      'snapshots:v1:create',
      {
        designId: 'd',
        parentId: null,
        type: 'initial',
        prompt: null,
        artifactType: 'html',
        artifactSource: '<html/>',
      },
    ],
  ];

  for (const [channel, sample] of channelsAndSamples) {
    it(`${channel} rejects missing schemaVersion with IPC_BAD_INPUT`, async () => {
      try {
        await callAsync(channel, sample);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CodesignError);
        expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
        expect((err as Error).message).toMatch(/schemaVersion/);
      }
    });

    it(`${channel} rejects schemaVersion: 2 with IPC_BAD_INPUT`, async () => {
      try {
        await callAsync(channel, { schemaVersion: 2, ...sample });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CodesignError);
        expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
        expect((err as Error).message).toMatch(/schemaVersion/);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// SQLite error translation
//
// Stubs better-sqlite3's prepare() to throw an Error carrying the SqliteError
// .code property and asserts each known code maps to the documented IPC code.
// Renderer must never see the raw "SqliteError: SQLITE_..." string.
// ---------------------------------------------------------------------------

describe('SQLite error translation', () => {
  function withDbThrowing(code: string, fn: () => unknown): unknown {
    const original = db.prepare.bind(db);
    const err = Object.assign(new Error(`${code}: synthetic`), { code });
    // Throw on the INSERT used by createSnapshot; pass through every other prepare.
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (sql.trim().startsWith('INSERT INTO design_snapshots')) {
        throw err;
      }
      return original(sql);
    };
    try {
      return fn();
    } finally {
      (db as unknown as { prepare: typeof original }).prepare = original;
    }
  }

  function attemptCreate(): unknown {
    const design = createDesign(db);
    return call(
      'snapshots:v1:create',
      v1({
        designId: design.id,
        parentId: null,
        type: 'initial',
        prompt: null,
        artifactType: 'html',
        artifactSource: '<html/>',
      }),
    );
  }

  it('translates SQLITE_CONSTRAINT_FOREIGNKEY to IPC_BAD_INPUT', () => {
    try {
      withDbThrowing('SQLITE_CONSTRAINT_FOREIGNKEY', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
      expect((err as Error).message).toBe('Referenced design or parent snapshot does not exist');
      expect((err as Error).message).not.toMatch(/SQLITE_/);
    }
  });

  it('translates SQLITE_BUSY to IPC_DB_BUSY', () => {
    try {
      withDbThrowing('SQLITE_BUSY', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('IPC_DB_BUSY');
      expect((err as Error).message).toBe('Database is locked, retry shortly');
    }
  });

  it('translates SQLITE_LOCKED to IPC_DB_BUSY', () => {
    try {
      withDbThrowing('SQLITE_LOCKED', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_DB_BUSY');
    }
  });

  it('translates SQLITE_FULL to IPC_DB_FULL', () => {
    try {
      withDbThrowing('SQLITE_FULL', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_DB_FULL');
      expect((err as Error).message).toBe('Disk is full');
    }
  });

  it('translates SQLITE_CONSTRAINT_UNIQUE to IPC_CONFLICT', () => {
    try {
      withDbThrowing('SQLITE_CONSTRAINT_UNIQUE', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('IPC_CONFLICT');
      expect((err as Error).message).toBe('Snapshot already exists');
      expect((err as Error).message).not.toMatch(/SQLITE_/);
    }
  });

  it('translates SQLITE_CONSTRAINT_NOTNULL to IPC_BAD_INPUT with neutral message', () => {
    try {
      withDbThrowing('SQLITE_CONSTRAINT_NOTNULL', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
      expect((err as Error).message).toBe('Snapshot input violates database constraints');
      expect((err as Error).message).not.toMatch(/Parent snapshot/);
    }
  });

  it('translates SQLITE_CONSTRAINT_CHECK to IPC_BAD_INPUT with neutral message', () => {
    try {
      withDbThrowing('SQLITE_CONSTRAINT_CHECK', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
      expect((err as Error).message).toBe('Snapshot input violates database constraints');
    }
  });

  it('translates bare SQLITE_CONSTRAINT (no subcode) to generic IPC_DB_ERROR', () => {
    try {
      withDbThrowing('SQLITE_CONSTRAINT', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('IPC_DB_ERROR');
      expect((err as Error).message).not.toMatch(/Parent snapshot/);
      expect((err as Error).message).not.toMatch(/SQLITE_/);
      expect((err as Error).cause).toBeDefined();
    }
  });

  it('translates unknown SQLite errors to IPC_DB_ERROR with no leak', () => {
    try {
      withDbThrowing('SQLITE_CORRUPT', attemptCreate);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CodesignError);
      expect((err as CodesignError).code).toBe('IPC_DB_ERROR');
      expect((err as Error).message).not.toMatch(/SQLITE_/);
      // Original error preserved for server-side logging only.
      expect((err as Error).cause).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:workspace:pick
// ---------------------------------------------------------------------------

describe('snapshots:v1:workspace:pick', () => {
  it('returns null when user cancels the dialog', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const result = await callAsync('snapshots:v1:workspace:pick', v1({}));
    expect(result).toBeNull();
  });

  it('returns the selected folder path', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/home/user/my-workspace'],
    });
    const result = await callAsync('snapshots:v1:workspace:pick', v1({}));
    expect(result).toBe('/home/user/my-workspace');
  });

  it('rejects non-object payload with IPC_BAD_INPUT', async () => {
    try {
      await callAsync('snapshots:v1:workspace:pick', null);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects missing schemaVersion with IPC_BAD_INPUT', async () => {
    try {
      await callAsync('snapshots:v1:workspace:pick', {});
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('returns null when filePaths is empty', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [],
    });
    const result = await callAsync('snapshots:v1:workspace:pick', v1({}));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:workspace:update
// ---------------------------------------------------------------------------

describe('snapshots:v1:workspace:update', () => {
  it('updates workspace and returns the design', async () => {
    const design = createDesign(db, 'Test');
    const updated = { ...design, workspacePath: '/new/path' };
    vi.mocked(bindWorkspace).mockResolvedValueOnce(updated);
    const result = await callAsync(
      'snapshots:v1:workspace:update',
      v1({ designId: design.id, workspacePath: '/new/path', migrateFiles: false }),
    );
    expect(result).toEqual(updated);
  });

  it('throws IPC_NOT_FOUND when design does not exist', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    vi.mocked(bindWorkspace).mockResolvedValueOnce(null as any);
    try {
      await callAsync(
        'snapshots:v1:workspace:update',
        v1({ designId: 'missing', workspacePath: '/path', migrateFiles: false }),
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_NOT_FOUND');
    }
  });

  it('throws IPC_CONFLICT when workspace is already bound', async () => {
    const design = createDesign(db, 'Test');
    vi.mocked(bindWorkspace).mockRejectedValueOnce(new Error('already bound to another design'));
    try {
      await callAsync(
        'snapshots:v1:workspace:update',
        v1({ designId: design.id, workspacePath: '/path', migrateFiles: false }),
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_CONFLICT');
    }
  });

  it('rejects non-object payload with IPC_BAD_INPUT', async () => {
    try {
      await callAsync('snapshots:v1:workspace:update', null);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects missing designId with IPC_BAD_INPUT', async () => {
    try {
      await callAsync(
        'snapshots:v1:workspace:update',
        v1({ workspacePath: '/path', migrateFiles: false }),
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('accepts null workspacePath to clear binding', async () => {
    const design = createDesign(db, 'Test');
    const cleared = { ...design, workspacePath: null };
    vi.mocked(bindWorkspace).mockResolvedValueOnce(cleared);
    const result = await callAsync(
      'snapshots:v1:workspace:update',
      v1({ designId: design.id, workspacePath: null, migrateFiles: false }),
    );
    expect(result).toEqual(cleared);
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:workspace:check
// ---------------------------------------------------------------------------

describe('snapshots:v1:workspace:check', () => {
  it('returns true when the workspace folder exists', async () => {
    const design = createDesign(db, 'Test');
    updateDesignWorkspace(db, design.id, '/tmp/workspace');
    vi.mocked(checkWorkspaceFolderExists).mockResolvedValueOnce(true);
    const result = await callAsync('snapshots:v1:workspace:check', v1({ designId: design.id }));
    expect(result).toEqual({ exists: true });
    expect(vi.mocked(checkWorkspaceFolderExists)).toHaveBeenCalledWith('/tmp/workspace');
  });

  it('returns false when the workspace folder does not exist', async () => {
    const design = createDesign(db, 'Test');
    updateDesignWorkspace(db, design.id, '/tmp/missing');
    vi.mocked(checkWorkspaceFolderExists).mockResolvedValueOnce(false);
    const result = await callAsync('snapshots:v1:workspace:check', v1({ designId: design.id }));
    expect(result).toEqual({ exists: false });
    expect(vi.mocked(checkWorkspaceFolderExists)).toHaveBeenCalledWith('/tmp/missing');
  });

  it('throws IPC_NOT_FOUND when design does not exist', async () => {
    try {
      await callAsync('snapshots:v1:workspace:check', v1({ designId: 'missing' }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_NOT_FOUND');
    }
  });

  it('throws IPC_BAD_INPUT when design has no workspace path', async () => {
    const design = createDesign(db, 'Test'); // No workspace bound
    try {
      await callAsync('snapshots:v1:workspace:check', v1({ designId: design.id }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
      expect((err as Error).message).toBe('Design is not bound to a workspace');
    }
  });

  it('rejects non-object payload with IPC_BAD_INPUT', async () => {
    try {
      await callAsync('snapshots:v1:workspace:check', null);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects missing designId with IPC_BAD_INPUT', async () => {
    try {
      await callAsync('snapshots:v1:workspace:check', v1({}));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// snapshots:v1:workspace:open
// ---------------------------------------------------------------------------

describe('snapshots:v1:workspace:open', () => {
  it('opens the workspace folder for a design', async () => {
    const design = createDesign(db, 'Test');
    updateDesignWorkspace(db, design.id, '/tmp/workspace');
    vi.mocked(openWorkspaceFolder).mockResolvedValueOnce(undefined);
    await callAsync('snapshots:v1:workspace:open', v1({ designId: design.id }));
    expect(vi.mocked(openWorkspaceFolder)).toHaveBeenCalledWith('/tmp/workspace');
  });

  it('throws IPC_NOT_FOUND when design does not exist', async () => {
    try {
      await callAsync('snapshots:v1:workspace:open', v1({ designId: 'missing' }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_NOT_FOUND');
    }
  });

  it('rejects non-object payload with IPC_BAD_INPUT', async () => {
    try {
      await callAsync('snapshots:v1:workspace:open', null);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects missing designId with IPC_BAD_INPUT', async () => {
    try {
      await callAsync('snapshots:v1:workspace:open', v1({}));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});

// ---------------------------------------------------------------------------
// codesign:files:v1:write
// ---------------------------------------------------------------------------

describe('codesign:files:v1:write', () => {
  it('writes through to the bound workspace and mirrors design_files', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'codesign-files-write-'));
    try {
      const design = createDesign(db, 'Writable');
      updateDesignWorkspace(db, design.id, workspace);
      const content =
        'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{"accent":"#f97316"}/*EDITMODE-END*/;';

      const result = (await callAsync(
        'codesign:files:v1:write',
        v1({ designId: design.id, path: 'index.html', content }),
      )) as { path: string; content: string };

      expect(result.path).toBe('index.html');
      expect(result.content).toBe(content);
      expect(readFileSync(path.join(workspace, 'index.html'), 'utf8')).toBe(content);
      expect(viewDesignFile(db, design.id, 'index.html')?.content).toBe(content);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('writes data-url assets as binary workspace files while mirroring virtual content', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'codesign-files-asset-'));
    try {
      const design = createDesign(db, 'Asset Writable');
      updateDesignWorkspace(db, design.id, workspace);
      const content = PNG_HEADER_DATA_URL;

      const result = (await callAsync(
        'codesign:files:v1:write',
        v1({ designId: design.id, path: 'assets/hero.png', content }),
      )) as { path: string; content: string; size: number; kind: string };

      expect(result).toMatchObject({
        path: 'assets/hero.png',
        content,
        size: PNG_HEADER.length,
        kind: 'asset',
      });
      expect(readFileSync(path.join(workspace, 'assets/hero.png'))).toEqual(PNG_HEADER);
      expect(viewDesignFile(db, design.id, 'assets/hero.png')?.content).toBe(content);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// registerSnapshotsUnavailableIpc — DB init failure path
//
// When safeInitSnapshotsDb fails at boot, main/index.ts installs stub handlers
// instead of skipping registration entirely. Without these, every renderer
// call to window.codesign.snapshots.* would surface as Electron's opaque
// "No handler registered" rejection. The stub MUST throw a typed CodesignError
// with code SNAPSHOTS_UNAVAILABLE so the renderer can branch deterministically.
// ---------------------------------------------------------------------------

describe('registerSnapshotsUnavailableIpc', () => {
  beforeEach(() => {
    handlers.clear();
    registerSnapshotsUnavailableIpc('disk_full: out of space');
  });

  for (const channel of SNAPSHOTS_CHANNELS_V1) {
    it(`${channel} throws SNAPSHOTS_UNAVAILABLE instead of going unhandled`, () => {
      try {
        call(channel, { schemaVersion: 1 });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CodesignError);
        expect((err as CodesignError).code).toBe('SNAPSHOTS_UNAVAILABLE');
        expect((err as Error).message).toMatch(/Snapshots database failed to initialize/);
        expect((err as Error).message).toMatch(/disk_full: out of space/);
      }
    });
  }

  it('covers exactly the channels registered by registerSnapshotsIpc and registerWorkspaceIpc', () => {
    handlers.clear();
    const dbForLive = initInMemoryDb();
    registerSnapshotsIpc(dbForLive);
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerWorkspaceIpc(dbForLive, () => ({}) as any);
    const live = new Set(handlers.keys());
    handlers.clear();
    registerSnapshotsUnavailableIpc('reason');
    const stubs = new Set(handlers.keys());
    expect(stubs).toEqual(live);
  });
});

// ---------------------------------------------------------------------------
// Project management IPC: rename / soft-delete / duplicate / messages
// ---------------------------------------------------------------------------

describe('snapshots:v1:rename-design', () => {
  it('renames the design and returns the updated row', () => {
    const d = createDesign(db, 'Old');
    const updated = call('snapshots:v1:rename-design', v1({ id: d.id, name: 'New' })) as {
      name: string;
    };
    expect(updated.name).toBe('New');
  });

  it('rejects an empty name', () => {
    const d = createDesign(db);
    expect(() => call('snapshots:v1:rename-design', v1({ id: d.id, name: '   ' }))).toThrow();
  });

  it('throws IPC_NOT_FOUND for an unknown id', () => {
    try {
      call('snapshots:v1:rename-design', v1({ id: 'missing', name: 'x' }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_NOT_FOUND');
    }
  });
});

describe('snapshots:v1:set-thumbnail', () => {
  it('updates the thumbnail text', () => {
    const d = createDesign(db);
    const updated = call(
      'snapshots:v1:set-thumbnail',
      v1({ id: d.id, thumbnailText: 'preview snippet' }),
    ) as { thumbnailText: string | null };
    expect(updated.thumbnailText).toBe('preview snippet');
  });

  it('accepts null to clear', () => {
    const d = createDesign(db);
    call('snapshots:v1:set-thumbnail', v1({ id: d.id, thumbnailText: 'x' }));
    const cleared = call('snapshots:v1:set-thumbnail', v1({ id: d.id, thumbnailText: null })) as {
      thumbnailText: string | null;
    };
    expect(cleared.thumbnailText).toBeNull();
  });
});

describe('snapshots:v1:soft-delete-design', () => {
  it('hides the design from list-designs', () => {
    const d = createDesign(db, 'Doomed');
    call('snapshots:v1:soft-delete-design', v1({ id: d.id }));
    const list = call('snapshots:v1:list-designs', { schemaVersion: 1 }) as Array<{ id: string }>;
    expect(list.find((row) => row.id === d.id)).toBeUndefined();
  });
});

describe('snapshots:v1:duplicate-design', () => {
  it('clones the design and reports a different id', () => {
    const source = createDesign(db, 'Source');
    const cloned = call(
      'snapshots:v1:duplicate-design',
      v1({ id: source.id, name: 'Source copy' }),
    ) as { id: string; name: string };
    expect(cloned.id).not.toBe(source.id);
    expect(cloned.name).toBe('Source copy');
  });
});

describe('snapshots:v1:get-design', () => {
  it('returns the design row by id', () => {
    const d = createDesign(db, 'Lookup me');
    const found = call('snapshots:v1:get-design', v1({ id: d.id })) as { name: string } | null;
    expect(found?.name).toBe('Lookup me');
  });

  it('returns null for an unknown id', () => {
    expect(call('snapshots:v1:get-design', v1({ id: 'nope' }))).toBeNull();
  });
});
