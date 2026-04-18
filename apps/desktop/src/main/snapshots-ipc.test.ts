/**
 * Unit tests for snapshots-ipc.ts.
 *
 * Mocks electron-runtime so ipcMain.handle() can be intercepted, then
 * calls the registered handlers directly with an in-memory DB.
 */

import { CodesignError } from '@open-codesign/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Collect registered handlers so tests can invoke them directly.
const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();

vi.mock('./electron-runtime', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, raw: unknown) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

vi.mock('./logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createDesign, createSnapshot, initInMemoryDb } from './snapshots-db';
import {
  SNAPSHOTS_CHANNELS_V1,
  registerSnapshotsIpc,
  registerSnapshotsUnavailableIpc,
} from './snapshots-ipc';

function call(channel: string, raw: unknown): unknown {
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

beforeEach(() => {
  handlers.clear();
  db = initInMemoryDb();
  registerSnapshotsIpc(db);
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
  it('creates a design with the trimmed name', () => {
    const result = call('snapshots:v1:create-design', v1({ name: '  My design  ' })) as Record<
      string,
      unknown
    >;
    expect(result['name']).toBe('My design');
    expect(typeof result['id']).toBe('string');
  });

  it('rejects undefined with IPC_BAD_INPUT (no silent default)', () => {
    expect(() => call('snapshots:v1:create-design', undefined)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create-design', undefined);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects an empty / whitespace-only name with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:create-design', v1({ name: '   ' }))).toThrow(CodesignError);
    try {
      call('snapshots:v1:create-design', v1({ name: '' }));
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects a non-string name with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:create-design', v1({ name: 42 }))).toThrow(CodesignError);
    try {
      call('snapshots:v1:create-design', v1({ name: { wrong: true } }));
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
    it(`${channel} rejects missing schemaVersion with IPC_BAD_INPUT`, () => {
      try {
        call(channel, sample);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CodesignError);
        expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
        expect((err as Error).message).toMatch(/schemaVersion/);
      }
    });

    it(`${channel} rejects schemaVersion: 2 with IPC_BAD_INPUT`, () => {
      try {
        call(channel, { schemaVersion: 2, ...sample });
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

  it('covers exactly the channels registered by registerSnapshotsIpc', () => {
    handlers.clear();
    const dbForLive = initInMemoryDb();
    registerSnapshotsIpc(dbForLive);
    const live = new Set(handlers.keys());
    handlers.clear();
    registerSnapshotsUnavailableIpc('reason');
    const stubs = new Set(handlers.keys());
    expect(stubs).toEqual(live);
  });
});
