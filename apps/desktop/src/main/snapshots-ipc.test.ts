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
import { registerSnapshotsIpc } from './snapshots-ipc';

function call(channel: string, raw: unknown): unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler for channel: ${channel}`);
  return fn(null, raw);
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
    const result = call('snapshots:v1:list-designs', undefined);
    expect(result).toEqual([]);
  });

  it('returns created designs', () => {
    createDesign(db, 'Test design');
    const result = call('snapshots:v1:list-designs', undefined) as unknown[];
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
    const result = call('snapshots:v1:list', { designId: design.id }) as unknown[];
    expect(result).toHaveLength(1);
  });

  it('rejects a missing designId with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:list', {})).toThrow(CodesignError);
    try {
      call('snapshots:v1:list', {});
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
    const input = {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: 'Build a hero section',
      artifactType: 'html',
      artifactSource: '<html>hero</html>',
    };
    const result = call('snapshots:v1:create', input) as Record<string, unknown>;
    expect(result['id']).toBeTruthy();
    expect(result['designId']).toBe(design.id);
    expect(result['type']).toBe('initial');
  });

  it('rejects bad payload (missing designId) with IPC_BAD_INPUT', () => {
    const bad = {
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    };
    expect(() => call('snapshots:v1:create', bad)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', bad);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects invalid type with IPC_BAD_INPUT', () => {
    const bad = {
      designId: 'some-id',
      parentId: null,
      type: 'invalid-type',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    };
    expect(() => call('snapshots:v1:create', bad)).toThrow(CodesignError);
    try {
      call('snapshots:v1:create', bad);
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });

  it('rejects invalid artifactType with IPC_BAD_INPUT', () => {
    const bad = {
      designId: 'some-id',
      parentId: null,
      type: 'edit',
      prompt: null,
      artifactType: 'pptx',
      artifactSource: '<html/>',
    };
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
});

// ---------------------------------------------------------------------------
// snapshots:v1:get
// ---------------------------------------------------------------------------

describe('snapshots:v1:get', () => {
  it('returns null for an unknown id', () => {
    const result = call('snapshots:v1:get', { id: 'ghost' });
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
    const result = call('snapshots:v1:get', { id: snap.id }) as Record<string, unknown>;
    expect(result['id']).toBe(snap.id);
  });

  it('rejects missing id with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:get', {})).toThrow(CodesignError);
    try {
      call('snapshots:v1:get', {});
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
    call('snapshots:v1:delete', { id: snap.id });
    const result = call('snapshots:v1:get', { id: snap.id });
    expect(result).toBeNull();
  });

  it('rejects missing id with IPC_BAD_INPUT', () => {
    expect(() => call('snapshots:v1:delete', {})).toThrow(CodesignError);
    try {
      call('snapshots:v1:delete', {});
    } catch (err) {
      expect((err as CodesignError).code).toBe('IPC_BAD_INPUT');
    }
  });
});
