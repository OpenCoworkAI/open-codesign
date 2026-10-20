import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommentApplyResultV1, commentContentFingerprint } from '@open-codesign/shared';
import { expect, it, vi } from 'vitest';
import { appendSessionComment, listSessionComments, updateSessionComment } from './session-chat';
import { createDesign, initSnapshotsDb, updateDesignWorkspace } from './snapshots-db';
import { registerSnapshotsIpc } from './snapshots-ipc';

const handlers = vi.hoisted(() => new Map<string, (event: unknown, payload: unknown) => unknown>());
vi.mock('./electron-runtime', () => ({
  app: { getPath: () => 'C:\\synthetic-cas' },
  dialog: {},
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) =>
      handlers.set(channel, handler),
  },
}));

it('atomically applies only expected pending revisions and retains legacy explicit marking', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codesign-comment-cas-'));
  try {
    const db = initSnapshotsDb(path.join(root, 'store.json'));
    const design = createDesign(db, 'CAS');
    updateDesignWorkspace(db, design.id, root);
    const opts = { db, sessionDir: db.sessionDir };
    const first = appendSessionComment(opts, {
      designId: design.id,
      snapshotId: 'before',
      kind: 'edit',
      text: 'Red',
      tag: 'h1',
      selector: '#heading',
      outerHTML: '<h1>Title</h1>',
      rect: { top: 0, left: 0, width: 10, height: 10 },
    });
    const second = appendSessionComment(opts, {
      designId: design.id,
      snapshotId: 'before',
      kind: 'edit',
      text: 'Spacing',
      tag: 'main',
      selector: '#body',
      outerHTML: '<main>Body</main>',
      rect: { top: 0, left: 0, width: 10, height: 10 },
    });
    registerSnapshotsIpc(db);
    const mark = handlers.get('comments:v1:mark-applied');
    if (!mark) throw new Error('Missing CAS IPC');
    const payload = {
      schemaVersion: 1,
      designId: design.id,
      ids: [first.id, second.id, 'missing'],
      snapshotId: 'after',
      expectedContent: {
        [first.id]: commentContentFingerprint(first),
        [second.id]: commentContentFingerprint(second),
      },
    };
    updateSessionComment(opts, design.id, first.id, { text: 'Blue' });
    const result = CommentApplyResultV1.parse(mark({}, payload));
    expect(result.applied.map((row) => row.id)).toEqual([second.id]);
    expect(result.conflictedIds).toEqual([first.id, 'missing']);
    expect(listSessionComments(opts, design.id).find((row) => row.id === first.id)).toMatchObject({
      text: 'Blue',
      status: 'pending',
      appliedInSnapshotId: null,
    });
    expect(() => mark({}, { ...payload, expectedContent: { [first.id]: 42 } })).toThrow(
      'expectedContent',
    );
    expect(mark({}, { ...payload, ids: [first.id], expectedContent: {} })).toMatchObject({
      applied: [],
      conflictedIds: [first.id],
    });
    expect(
      mark({}, { schemaVersion: 1, designId: design.id, ids: [first.id], snapshotId: 'manual' }),
    ).toMatchObject([{ id: first.id, status: 'applied' }]);
    updateSessionComment(opts, design.id, first.id, { text: 'Green' });
    const reopened = initSnapshotsDb(path.join(root, 'store.json'));
    expect(
      listSessionComments({ db: reopened, sessionDir: reopened.sessionDir }, design.id).find(
        (row) => row.id === first.id,
      ),
    ).toMatchObject({
      text: 'Green',
      status: 'pending',
      appliedInSnapshotId: null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
