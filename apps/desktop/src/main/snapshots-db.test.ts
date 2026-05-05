import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createDesign,
  createSnapshot,
  getDesign,
  initInMemoryDb,
  initSnapshotsDb,
  listDesigns,
  listDiagnosticEvents,
  listSnapshots,
  recordDiagnosticEvent,
  touchDesignActivity,
  updateDesignWorkspace,
  upsertDesignFile,
} from './snapshots-db';
import { normalizeWorkspacePath } from './workspace-path';

describe('json design store', () => {
  it('persists designs and snapshots without a native database binding', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-json-store-'));
    try {
      const storePath = path.join(root, 'design-store.json');
      const db = initSnapshotsDb(storePath);
      const design = createDesign(db, 'Workspace-first design');
      updateDesignWorkspace(db, design.id, root);
      const snapshot = createSnapshot(db, {
        designId: design.id,
        parentId: null,
        type: 'initial',
        prompt: 'make a landing page',
        artifactType: 'html',
        artifactSource: '<main>Hello</main>',
      });

      const reopened = initSnapshotsDb(storePath);
      expect(getDesign(reopened, design.id)?.workspacePath).toBe(normalizeWorkspacePath(root));
      expect(listDesigns(reopened).map((row) => row.id)).toEqual([design.id]);
      expect(listSnapshots(reopened, design.id).map((row) => row.id)).toEqual([snapshot.id]);
      await expect(readFile(storePath, 'utf8')).resolves.toContain('Workspace-first design');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('deduplicates diagnostic events in the same short window', () => {
    const db = initInMemoryDb();
    const first = recordDiagnosticEvent(
      db,
      {
        level: 'error',
        code: 'TEST',
        scope: 'unit',
        runId: undefined,
        fingerprint: 'fp',
        message: 'boom',
        stack: undefined,
        transient: false,
      },
      () => 1_000,
    );
    const second = recordDiagnosticEvent(
      db,
      {
        level: 'error',
        code: 'TEST',
        scope: 'unit',
        runId: undefined,
        fingerprint: 'fp',
        message: 'boom again',
        stack: undefined,
        transient: true,
      },
      () => 1_100,
    );

    expect(second).toBe(first);
    expect(listDiagnosticEvents(db, { includeTransient: true })).toMatchObject([
      { id: first, count: 2, transient: true },
    ]);
  });

  it('sorts designs by explicit activity time without moving timestamps backward', () => {
    const db = initInMemoryDb();
    const first = createDesign(db, 'First');
    const second = createDesign(db, 'Second');

    touchDesignActivity(db, first.id, '2099-01-01T00:00:00.000Z');
    touchDesignActivity(db, first.id, '2000-01-01T00:00:00.000Z');

    expect(getDesign(db, first.id)?.updatedAt).toBe('2099-01-01T00:00:00.000Z');
    expect(listDesigns(db).map((design) => design.id)).toEqual([first.id, second.id]);
  });

  it('touches design activity when workspace files are upserted', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      const db = initInMemoryDb();
      const design = createDesign(db, 'Workspace edits');

      vi.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
      upsertDesignFile(db, design.id, 'App.jsx', 'function App() { return <main />; }');

      expect(getDesign(db, design.id)?.updatedAt).toBe('2026-05-02T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});
