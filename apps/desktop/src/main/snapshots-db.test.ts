/**
 * Unit tests for snapshots-db.ts using an in-memory SQLite instance.
 *
 * No Electron, no filesystem — just better-sqlite3 :memory:.
 */

import { describe, expect, it } from 'vitest';
import {
  createDesign,
  createSnapshot,
  deleteSnapshot,
  getSnapshot,
  initInMemoryDb,
  listDesigns,
  listSnapshots,
} from './snapshots-db';

function makeDb() {
  return initInMemoryDb();
}

// ---------------------------------------------------------------------------
// designs
// ---------------------------------------------------------------------------

describe('createDesign + listDesigns', () => {
  it('creates a design with defaults and returns it via listDesigns', () => {
    const db = makeDb();
    const d = createDesign(db);
    expect(d.schemaVersion).toBe(1);
    expect(d.name).toBe('Untitled design');
    expect(typeof d.id).toBe('string');
    expect(d.id.length).toBeGreaterThan(0);
    expect(d.createdAt).toBeTruthy();
    expect(d.updatedAt).toBeTruthy();

    const list = listDesigns(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(d.id);
  });

  it('creates a design with a custom name', () => {
    const db = makeDb();
    const d = createDesign(db, 'My landing page');
    expect(d.name).toBe('My landing page');
  });

  it('orders designs by created_at DESC (most recent first)', () => {
    const db = makeDb();
    // Insert with a small delay via overriding created_at via raw SQL to guarantee ordering.
    const idA = 'aaaa-design';
    const idB = 'bbbb-design';
    db.prepare(
      'INSERT INTO designs (id, schema_version, name, created_at, updated_at) VALUES (?, 1, ?, ?, ?)',
    ).run(idA, 'A', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
    db.prepare(
      'INSERT INTO designs (id, schema_version, name, created_at, updated_at) VALUES (?, 1, ?, ?, ?)',
    ).run(idB, 'B', '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z');

    const list = listDesigns(db);
    const ids = list.map((d) => d.id);
    // B was created on day 2, A on day 1 — B should come first (DESC).
    expect(ids.indexOf(idB)).toBeLessThan(ids.indexOf(idA));
  });
});

// ---------------------------------------------------------------------------
// snapshots
// ---------------------------------------------------------------------------

describe('createSnapshot + listSnapshots', () => {
  it('creates an initial snapshot and lists it', () => {
    const db = makeDb();
    const design = createDesign(db);
    const snap = createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: 'Create a landing page',
      artifactType: 'html',
      artifactSource: '<html>v1</html>',
    });

    expect(snap.schemaVersion).toBe(1);
    expect(snap.designId).toBe(design.id);
    expect(snap.parentId).toBeNull();
    expect(snap.type).toBe('initial');
    expect(snap.artifactSource).toBe('<html>v1</html>');
    expect(snap.createdAt).toBeTruthy();

    const list = listSnapshots(db, design.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(snap.id);
  });

  it('lists snapshots ordered by created_at DESC', () => {
    const db = makeDb();
    const design = createDesign(db);
    // Insert with explicit timestamps to avoid sub-millisecond collisions.
    const insertSnap = (
      at: string,
      parentId: string | null,
      type: 'initial' | 'edit',
      prompt: string,
    ) => {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO design_snapshots
           (id, schema_version, design_id, parent_id, type, prompt, artifact_type, artifact_source, created_at, message)
         VALUES (?, 1, ?, ?, ?, ?, 'html', '<html/>', ?, NULL)`,
      ).run(id, design.id, parentId, type, prompt, at);
      return id;
    };
    const id1 = insertSnap('2024-01-01T00:00:00.000Z', null, 'initial', 'v1');
    const id2 = insertSnap('2024-01-02T00:00:00.000Z', id1, 'edit', 'v2');
    const id3 = insertSnap('2024-01-03T00:00:00.000Z', id2, 'edit', 'v3');

    const list = listSnapshots(db, design.id);
    expect(list).toHaveLength(3);
    // Most recent first.
    expect(list[0]?.id).toBe(id3);
    expect(list[1]?.id).toBe(id2);
    expect(list[2]?.id).toBe(id1);
  });

  it('builds a parent_id chain: initial → edit → edit', () => {
    const db = makeDb();
    const design = createDesign(db);
    const s1 = createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html>v1</html>',
    });
    const s2 = createSnapshot(db, {
      designId: design.id,
      parentId: s1.id,
      type: 'edit',
      prompt: 'tweak 1',
      artifactType: 'html',
      artifactSource: '<html>v2</html>',
    });
    const s3 = createSnapshot(db, {
      designId: design.id,
      parentId: s2.id,
      type: 'edit',
      prompt: 'tweak 2',
      artifactType: 'html',
      artifactSource: '<html>v3</html>',
    });

    expect(s1.parentId).toBeNull();
    expect(s2.parentId).toBe(s1.id);
    expect(s3.parentId).toBe(s2.id);
  });
});

// ---------------------------------------------------------------------------
// getSnapshot
// ---------------------------------------------------------------------------

describe('getSnapshot', () => {
  it('returns the snapshot by id', () => {
    const db = makeDb();
    const design = createDesign(db);
    const snap = createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'svg',
      artifactSource: '<svg/>',
    });

    const found = getSnapshot(db, snap.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(snap.id);
    expect(found?.artifactType).toBe('svg');
  });

  it('returns null for an unknown id', () => {
    const db = makeDb();
    expect(getSnapshot(db, 'does-not-exist')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteSnapshot
// ---------------------------------------------------------------------------

describe('deleteSnapshot', () => {
  it('deletes a snapshot so it no longer appears in listSnapshots', () => {
    const db = makeDb();
    const design = createDesign(db);
    const snap = createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });

    expect(listSnapshots(db, design.id)).toHaveLength(1);
    deleteSnapshot(db, snap.id);
    expect(listSnapshots(db, design.id)).toHaveLength(0);
    expect(getSnapshot(db, snap.id)).toBeNull();
  });

  it('is idempotent — deleting a non-existent id does not throw', () => {
    const db = makeDb();
    expect(() => deleteSnapshot(db, 'ghost-id')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FK cascade: deleting a design removes all its snapshots
// ---------------------------------------------------------------------------

describe('FK cascade on design delete', () => {
  it('removes snapshots when parent design is deleted (foreign_keys ON by default)', () => {
    const db = makeDb();

    const design = createDesign(db);
    createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    expect(listSnapshots(db, design.id)).toHaveLength(1);

    db.prepare('DELETE FROM designs WHERE id = ?').run(design.id);
    expect(listSnapshots(db, design.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Parent FK SET NULL: deleting a middle snapshot nulls its children's parent_id
// ---------------------------------------------------------------------------

describe('parent FK SET NULL on snapshot delete', () => {
  it('nulls child parent_id when the parent snapshot is deleted', () => {
    const db = makeDb();
    const design = createDesign(db);
    const s1 = createSnapshot(db, {
      designId: design.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html>v1</html>',
    });
    const s2 = createSnapshot(db, {
      designId: design.id,
      parentId: s1.id,
      type: 'edit',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html>v2</html>',
    });

    deleteSnapshot(db, s1.id);
    const reloaded = getSnapshot(db, s2.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.parentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listDesigns sort order: most recently active first
// ---------------------------------------------------------------------------

describe('listDesigns activity sort', () => {
  it('surfaces a design whose updated_at is newer than another design created later', () => {
    const db = makeDb();
    db.prepare(
      'INSERT INTO designs (id, schema_version, name, created_at, updated_at) VALUES (?, 1, ?, ?, ?)',
    ).run('older', 'A', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
    db.prepare(
      'INSERT INTO designs (id, schema_version, name, created_at, updated_at) VALUES (?, 1, ?, ?, ?)',
    ).run('newer', 'B', '2024-01-02T00:00:00.000Z', '2024-01-02T00:00:00.000Z');

    // Bump the older design's activity past the newer one.
    db.prepare('UPDATE designs SET updated_at = ? WHERE id = ?').run(
      '2024-01-03T00:00:00.000Z',
      'older',
    );

    const ids = listDesigns(db).map((d) => d.id);
    expect(ids.indexOf('older')).toBeLessThan(ids.indexOf('newer'));
  });
});
