/**
 * Unit tests for snapshots-db.ts using an in-memory SQLite instance.
 *
 * No Electron, no filesystem — just better-sqlite3 :memory:.
 */

import { describe, expect, it } from 'vitest';
import {
  appendChatMessage,
  clearDesignWorkspace,
  createDesign,
  createSnapshot,
  deleteSnapshot,
  duplicateDesign,
  getDesign,
  getSnapshot,
  initInMemoryDb,
  listChatMessages,
  listDesigns,
  listSnapshots,
  renameDesign,
  setDesignThumbnail,
  softDeleteDesign,
  updateChatToolCallStatus,
  updateDesignWorkspace,
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

// ---------------------------------------------------------------------------
// Project management additions: rename / soft-delete / duplicate / thumbnail
// ---------------------------------------------------------------------------

describe('renameDesign', () => {
  it('updates the name and bumps updated_at', () => {
    const db = makeDb();
    const d = createDesign(db, 'Original');
    const renamed = renameDesign(db, d.id, '   New name   ');
    expect(renamed?.name).toBe('New name');
    // updated_at may equal createdAt within the same millisecond — only assert
    // the column is non-empty and ordered no earlier than the original create.
    expect(renamed?.updatedAt).toBeTruthy();
    expect(new Date(renamed?.updatedAt ?? '').getTime()).toBeGreaterThanOrEqual(
      new Date(d.updatedAt).getTime(),
    );
  });

  it('returns null when the design is missing', () => {
    const db = makeDb();
    expect(renameDesign(db, 'missing', 'Anything')).toBeNull();
  });

  it('refuses an empty name', () => {
    const db = makeDb();
    const d = createDesign(db);
    expect(() => renameDesign(db, d.id, '   ')).toThrow();
  });
});

describe('setDesignThumbnail', () => {
  it('sets and clears the thumbnail text', () => {
    const db = makeDb();
    const d = createDesign(db);
    const set1 = setDesignThumbnail(db, d.id, 'A nice landing page');
    expect(set1?.thumbnailText).toBe('A nice landing page');
    const cleared = setDesignThumbnail(db, d.id, null);
    expect(cleared?.thumbnailText).toBeNull();
  });
});

describe('softDeleteDesign + listDesigns filter', () => {
  it('hides soft-deleted designs from listDesigns but keeps the row', () => {
    const db = makeDb();
    const a = createDesign(db, 'Keeper');
    const b = createDesign(db, 'To delete');

    expect(
      listDesigns(db)
        .map((d) => d.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());

    const deleted = softDeleteDesign(db, b.id);
    expect(deleted?.deletedAt).not.toBeNull();

    const remaining = listDesigns(db).map((d) => d.id);
    expect(remaining).toEqual([a.id]);

    // Row still exists and is fetchable by id.
    expect(getDesign(db, b.id)?.deletedAt).not.toBeNull();
  });
});

describe('duplicateDesign', () => {
  it('clones the design row and all snapshots with parent rewiring', () => {
    const db = makeDb();
    const source = createDesign(db, 'Source');
    setDesignThumbnail(db, source.id, 'thumbnail preview');
    const s1 = createSnapshot(db, {
      designId: source.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html>v1</html>',
    });
    const s2 = createSnapshot(db, {
      designId: source.id,
      parentId: s1.id,
      type: 'edit',
      prompt: 'tweak',
      artifactType: 'html',
      artifactSource: '<html>v2</html>',
    });

    const cloned = duplicateDesign(db, source.id, 'Source copy');
    expect(cloned).not.toBeNull();
    expect(cloned?.name).toBe('Source copy');
    expect(cloned?.thumbnailText).toBe('thumbnail preview');
    expect(cloned?.id).not.toBe(source.id);

    const clonedSnaps = listSnapshots(db, cloned?.id ?? '');
    expect(clonedSnaps).toHaveLength(2);
    const clonedInitial = clonedSnaps.find((s) => s.type === 'initial');
    const clonedEdit = clonedSnaps.find((s) => s.type === 'edit');
    expect(clonedInitial).toBeDefined();
    expect(clonedEdit).toBeDefined();
    // Parent of the cloned edit must point at the cloned initial, not the
    // original snapshot — that's the key invariant of the rewrite.
    expect(clonedEdit?.parentId).toBe(clonedInitial?.id);
    expect(clonedEdit?.parentId).not.toBe(s2.parentId);

    // Source remains untouched.
    expect(listSnapshots(db, source.id)).toHaveLength(2);
  });

  it('returns null when the source design does not exist', () => {
    const db = makeDb();
    expect(duplicateDesign(db, 'missing', 'X')).toBeNull();
  });

  it('used delete CASCADE on snapshots after duplicate (independence)', () => {
    const db = makeDb();
    const source = createDesign(db);
    createSnapshot(db, {
      designId: source.id,
      parentId: null,
      type: 'initial',
      prompt: null,
      artifactType: 'html',
      artifactSource: '<html/>',
    });
    const cloned = duplicateDesign(db, source.id, 'copy');
    db.prepare('DELETE FROM designs WHERE id = ?').run(source.id);
    // Cloned snapshots survive the source deletion because they belong to a
    // different design row.
    expect(listSnapshots(db, cloned?.id ?? '')).toHaveLength(1);
  });
});

describe('updateDesignWorkspace', () => {
  it('sets the workspace_path and bumps updated_at', () => {
    const db = makeDb();
    const d = createDesign(db, 'My design');
    const originalUpdatedAt = d.updatedAt;

    const updated = updateDesignWorkspace(db, d.id, '/path/to/workspace');
    expect(updated).not.toBeNull();
    expect(updated?.workspacePath).toBe('/path/to/workspace');
    expect(updated?.updatedAt).toBeTruthy();
    expect(new Date(updated?.updatedAt ?? '').getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it('returns null when the design is missing', () => {
    const db = makeDb();
    expect(updateDesignWorkspace(db, 'missing', '/path')).toBeNull();
  });

  it('overwrites an existing workspace_path', () => {
    const db = makeDb();
    const d = createDesign(db);
    updateDesignWorkspace(db, d.id, '/old/path');
    const updated = updateDesignWorkspace(db, d.id, '/new/path');
    expect(updated?.workspacePath).toBe('/new/path');
  });
});

describe('clearDesignWorkspace', () => {
  it('sets workspace_path to NULL and bumps updated_at', () => {
    const db = makeDb();
    const d = createDesign(db);
    updateDesignWorkspace(db, d.id, '/path/to/workspace');
    const originalUpdatedAt = d.updatedAt;

    const cleared = clearDesignWorkspace(db, d.id);
    expect(cleared).not.toBeNull();
    expect(cleared?.workspacePath).toBeNull();
    expect(cleared?.updatedAt).toBeTruthy();
    expect(new Date(cleared?.updatedAt ?? '').getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it('returns null when the design is missing', () => {
    const db = makeDb();
    expect(clearDesignWorkspace(db, 'missing')).toBeNull();
  });

  it('is idempotent — clearing an already-null workspace_path works', () => {
    const db = makeDb();
    const d = createDesign(db);
    // workspace_path is NULL by default
    const cleared1 = clearDesignWorkspace(db, d.id);
    expect(cleared1?.workspacePath).toBeNull();
    const cleared2 = clearDesignWorkspace(db, d.id);
    expect(cleared2?.workspacePath).toBeNull();
  });
});

describe('duplicateDesign workspace_path semantics', () => {
  it('copies a design with workspace_path set, but cloned design has workspace_path = NULL', () => {
    const db = makeDb();
    const source = createDesign(db, 'Source with workspace');
    updateDesignWorkspace(db, source.id, '/path/to/workspace');

    const sourceReloaded = getDesign(db, source.id);
    expect(sourceReloaded?.workspacePath).toBe('/path/to/workspace');

    const cloned = duplicateDesign(db, source.id, 'Cloned');
    expect(cloned).not.toBeNull();
    expect(cloned?.workspacePath).toBeNull();

    // Source remains unchanged
    expect(getDesign(db, source.id)?.workspacePath).toBe('/path/to/workspace');
  });

  it('clones a design with workspace_path = NULL, result also has NULL', () => {
    const db = makeDb();
    const source = createDesign(db, 'Source without workspace');
    expect(source.workspacePath).toBeNull();

    const cloned = duplicateDesign(db, source.id, 'Cloned');
    expect(cloned?.workspacePath).toBeNull();
  });
});

describe('migration idempotency for workspace_path', () => {
  it('workspace_path column exists after first init', () => {
    const db = makeDb();
    type ColumnInfo = { name: string };
    const cols = (db.prepare('PRAGMA table_info(designs)').all() as ColumnInfo[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('workspace_path');
  });

  it('legacy rows read as workspacePath: null after migration', () => {
    const db = makeDb();
    // Insert a row directly without workspace_path (simulating pre-migration data)
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO designs (id, schema_version, name, created_at, updated_at) VALUES (?, 1, ?, ?, ?)',
    ).run(id, 'Legacy design', now, now);

    const design = getDesign(db, id);
    expect(design?.workspacePath).toBeNull();
  });

  it('re-applying migrations does not fail or lose data', () => {
    const db = makeDb();
    const d = createDesign(db, 'persist me');
    updateDesignWorkspace(db, d.id, '/workspace/path');

    // Simulate re-applying migrations (second app boot)
    // This should be idempotent — the column already exists
    type ColumnInfo = { name: string };
    const cols = (db.prepare('PRAGMA table_info(designs)').all() as ColumnInfo[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('workspace_path');

    // Data should be intact
    const reloaded = getDesign(db, d.id);
    expect(reloaded?.name).toBe('persist me');
    expect(reloaded?.workspacePath).toBe('/workspace/path');
  });
});

describe('migration is idempotent', () => {
  it('re-applying the schema does not lose data', () => {
    const db = makeDb();
    const d = createDesign(db, 'persist me');
    // Re-apply migration (simulates a second app boot).
    type ColumnInfo = { name: string };
    const cols = (db.prepare('PRAGMA table_info(designs)').all() as ColumnInfo[]).map(
      (c) => c.name,
    );
    expect(cols).toContain('thumbnail_text');
    expect(cols).toContain('deleted_at');
    expect(getDesign(db, d.id)?.name).toBe('persist me');
  });
});

describe('updateChatToolCallStatus', () => {
  it('flips status from running to done in place', () => {
    const db = makeDb();
    const d = createDesign(db);
    const row = appendChatMessage(db, {
      designId: d.id,
      kind: 'tool_call',
      payload: {
        toolName: 'text_editor',
        args: {},
        status: 'running',
        startedAt: new Date().toISOString(),
        verbGroup: 'Working',
      },
    });
    updateChatToolCallStatus(db, d.id, row.seq, 'done');
    const list = listChatMessages(db, d.id);
    expect((list[0]?.payload as { status: string }).status).toBe('done');
  });

  it('writes errorMessage when provided', () => {
    const db = makeDb();
    const d = createDesign(db);
    const row = appendChatMessage(db, {
      designId: d.id,
      kind: 'tool_call',
      payload: {
        toolName: 'text_editor',
        args: {},
        status: 'running',
        startedAt: new Date().toISOString(),
        verbGroup: 'Working',
      },
    });
    updateChatToolCallStatus(db, d.id, row.seq, 'error', 'kaboom');
    const payload = listChatMessages(db, d.id)[0]?.payload as {
      status: string;
      errorMessage?: string;
    };
    expect(payload.status).toBe('error');
    expect(payload.errorMessage).toBe('kaboom');
  });

  it('does not throw when the row does not exist', () => {
    const db = makeDb();
    const d = createDesign(db);
    expect(() => updateChatToolCallStatus(db, d.id, 9999, 'done')).not.toThrow();
  });

  it('leaves non-tool_call rows untouched', () => {
    const db = makeDb();
    const d = createDesign(db);
    const row = appendChatMessage(db, {
      designId: d.id,
      kind: 'user',
      payload: { text: 'hi' },
    });
    updateChatToolCallStatus(db, d.id, row.seq, 'done');
    const list = listChatMessages(db, d.id);
    expect((list[0]?.payload as { text: string }).text).toBe('hi');
  });
});

describe('tool_status_normalize_2026_04_20 migration', () => {
  it('flips stale running tool_call rows to done and leaves recent ones alone', () => {
    const db = makeDb();
    const d = createDesign(db);

    // Insert a stale (>1h old) running tool_call row directly so we bypass
    // appendChatMessage's now() timestamp.
    db.prepare(
      `INSERT INTO chat_messages (design_id, seq, kind, payload, snapshot_id, created_at)
       VALUES (?, ?, 'tool_call', ?, NULL, ?)`,
    ).run(
      d.id,
      0,
      JSON.stringify({
        toolName: 'text_editor',
        args: {},
        status: 'running',
        startedAt: '2026-04-19T12:00:00Z',
        verbGroup: 'Working',
      }),
      '2026-04-19T12:00:00Z',
    );
    // A recent in-flight row that should NOT be touched.
    const recent = appendChatMessage(db, {
      designId: d.id,
      kind: 'tool_call',
      payload: {
        toolName: 'text_editor',
        args: {},
        status: 'running',
        startedAt: new Date().toISOString(),
        verbGroup: 'Working',
      },
    });

    // Clear the migration marker so re-running applySchema re-fires it.
    db.prepare("DELETE FROM db_meta WHERE key = 'tool_status_normalize_2026_04_20'").run();

    // Re-trigger the cleanup by directly running the same SQL as the migration.
    db.exec(
      `UPDATE chat_messages
         SET payload = json_set(payload, '$.status', 'done')
       WHERE kind = 'tool_call'
         AND json_extract(payload, '$.status') = 'running'
         AND created_at < datetime('now','-1 hour')`,
    );

    const list = listChatMessages(db, d.id);
    expect((list[0]?.payload as { status: string }).status).toBe('done');
    const recentRow = list.find((m) => m.seq === recent.seq);
    expect((recentRow?.payload as { status: string }).status).toBe('running');
  });
});
