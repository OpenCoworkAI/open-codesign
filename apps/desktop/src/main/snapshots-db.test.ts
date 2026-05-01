import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
  updateDesignWorkspace,
} from './snapshots-db';

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
      expect(getDesign(reopened, design.id)?.workspacePath).toBe(root);
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
});
