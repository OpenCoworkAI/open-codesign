import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceIdentityV1 } from '@open-codesign/shared';
import { withWorkspaceFileWriter } from '@open-codesign/shared/workspace-file-lock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGenerationSource } from './generation-source';
import {
  createDesign,
  initInMemoryDb,
  updateDesignPreview,
  updateDesignWorkspace,
} from './snapshots-db';
import {
  changeSourceEntryWorkspace,
  getSourceEntry,
  initializeSourceEntry,
  notifyAutoManagedSourceRename,
} from './source-entry';
import * as sourceEntryStore from './source-entry-store';
import { sourceEntryFile } from './source-entry-store';
import { runWithWorkspaceRenameQueue } from './workspace-path-lock';

vi.mock('./logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(planned = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'generation-source-'));
  roots.push(root);
  const db = { ...initInMemoryDb(), sessionDir: path.join(root, 'sessions') };
  const design = createDesign(db);
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  updateDesignWorkspace(db, design.id, workspace);
  if (planned) await initializeSourceEntry(db, design.id);
  const controller = new AbortController();
  const running = new Map([[design.id, { generationId: 'run', startedAt: 0 }]]);
  const workspaces = new Map<string, { generationId: string; startedAt: number }>();
  const admit = () =>
    createGenerationSource({
      db,
      designId: design.id,
      generationId: 'run',
      signal: controller.signal,
      inFlightByDesign: running,
      inFlightByWorkspace: workspaces,
    });
  return { db, design, root, workspace, controller, running, workspaces, admit };
}

describe('generation source lifecycle', () => {
  it('admits planned missing source, not renderer guesses', async () => {
    const f = await fixture();
    const run = await f.admit();
    expect(run.source).toMatchObject({ path: 'index.html', runtimeMode: 'native-html' });
    expect(run.initialContent).toBeNull();
    run.dispose();
    expect(f.workspaces.size).toBe(0);
  });
  it('rejects imported empty workspace without taking ownership', async () => {
    const f = await fixture(false);
    await expect(f.admit()).rejects.toThrow(/source|selection/i);
    expect(f.workspaces.size).toBe(0);
  });
  it('rejects ambiguous imported sources without acquiring workspace ownership', async () => {
    const f = await fixture(false);
    await writeFile(path.join(f.workspace, 'App.jsx'), 'function App(){return null;}');
    await writeFile(path.join(f.workspace, 'index.html'), '<p>Other</p>');
    expect(await getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'needs-selection' });
    await expect(f.admit()).rejects.toThrow(/source|selection/i);
    expect(f.workspaces.size).toBe(0);
  });
  it('retains the nonmanaged connected-preview path without inventing source identity', async () => {
    const f = await fixture(false);
    updateDesignPreview(f.db, f.design.id, 'connected-url', 'http://localhost:5173/');
    const run = await f.admit();
    expect(run.source).toBeUndefined();
    expect(run.runtimeMode('index.html')).toBeUndefined();
    await run.confirm(true);
    expect(run.committed).toBe(false);
    expect(await getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'not-applicable' });
    run.dispose();
    expect(f.workspaces.size).toBe(0);
  });
  it('rejects a forged acceptance callback without runtime proof', async () => {
    const f = await fixture();
    const run = await f.admit();
    await expect(
      run.accept({ source: SourceIdentityV1.parse(run.source), content: '<p>Fake</p>' }),
    ).rejects.toThrow(/verif/i);
    run.dispose();
  });
  it('confirms raw source only after host verification', async () => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<img src="assets/photo.png">';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    await run.confirm(true);
    expect(await getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'ready', content });
    run.dispose();
  });
  it.each([
    'replace',
    'delete',
    'cancel',
    'revision',
  ])('rejects %s before confirmation', async (action) => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    if (action === 'replace')
      await writeFile(path.join(f.workspace, 'index.html'), '<p>External</p>');
    if (action === 'delete') await rm(path.join(f.workspace, 'index.html'));
    if (action === 'cancel') f.controller.abort();
    if (action === 'revision')
      await runWithWorkspaceRenameQueue(f.design.id, () =>
        changeSourceEntryWorkspace(
          f.db,
          f.design.id,
          path.join(f.root, 'other'),
          false,
          async () => {
            await mkdir(path.join(f.root, 'other'));
          },
        ),
      );
    await expect(run.confirm(true)).rejects.toThrow();
    run.dispose();
  });
  it('advances exact sanctioned rename tuples and ownership without nested leases', async () => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    let current = f.workspace;
    for (const name of ['renamed', 'renamed-again']) {
      const next = path.join(f.root, name);
      await runWithWorkspaceRenameQueue(f.design.id, () =>
        changeSourceEntryWorkspace(
          f.db,
          f.design.id,
          next,
          true,
          () => rename(current, next),
          'blank-canvas',
          notifyAutoManagedSourceRename,
        ),
      );
      current = next;
      expect(
        await run.withWorkspace((root) => readFile(path.join(root, 'index.html'), 'utf8')),
      ).toBe(content);
      expect(f.workspaces.size).toBe(1);
    }
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    await run.confirm(true);
    run.dispose();
    expect(f.workspaces.size).toBe(0);
  });
  it('confirms after a sanctioned rename already queued at confirmation invocation', async () => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    const next = path.join(f.root, 'queued-rename');
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const renaming = runWithWorkspaceRenameQueue(f.design.id, async () => {
      await hold;
      return changeSourceEntryWorkspace(
        f.db,
        f.design.id,
        next,
        true,
        () => rename(f.workspace, next),
        'blank-canvas',
        notifyAutoManagedSourceRename,
      );
    });
    const confirmed = expect(run.confirm(true)).resolves.toBeUndefined();
    release();
    try {
      await renaming;
      await confirmed;
      expect(await getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'ready', content });
    } finally {
      run.dispose();
    }
  });
  it('adopts its committed revision before an immediately queued rename can notify', async () => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    const next = path.join(f.root, 'after-commit');
    let renaming: Promise<unknown> | undefined;
    const write = sourceEntryStore.writeSourceEntryFile;
    const spy = vi
      .spyOn(sourceEntryStore, 'writeSourceEntryFile')
      .mockImplementation(async (...args) => {
        await write(...args);
        if (!renaming)
          renaming = runWithWorkspaceRenameQueue(f.design.id, () =>
            changeSourceEntryWorkspace(
              f.db,
              f.design.id,
              next,
              true,
              () => rename(f.workspace, next),
              'blank-canvas',
              notifyAutoManagedSourceRename,
            ),
          );
      });
    try {
      await run.confirm(true);
      await renaming;
      expect(path.normalize(run.workspaceRoot)).toBe(path.normalize(next));
      expect(
        await run.withWorkspace((root) => readFile(path.join(root, 'index.html'), 'utf8')),
      ).toBe(content);
      const other = createDesign(f.db);
      updateDesignWorkspace(f.db, other.id, next);
      await initializeSourceEntry(f.db, other.id);
      f.running.set(other.id, { generationId: 'other', startedAt: 0 });
      await expect(
        createGenerationSource({
          db: f.db,
          designId: other.id,
          generationId: 'other',
          signal: f.controller.signal,
          inFlightByDesign: f.running,
          inFlightByWorkspace: f.workspaces,
        }),
      ).rejects.toThrow(/already|progress|running/i);
    } finally {
      spy.mockRestore();
      run.dispose();
    }
  });
  it('blocks a shared-workspace run until confirmation completes and ownership is disposed', async () => {
    const f = await fixture();
    const run = await f.admit();
    const other = createDesign(f.db);
    updateDesignWorkspace(f.db, other.id, f.workspace);
    await initializeSourceEntry(f.db, other.id);
    f.running.set(other.id, { generationId: 'other-run', startedAt: 0 });
    const otherRun = () =>
      createGenerationSource({
        db: f.db,
        designId: other.id,
        generationId: 'other-run',
        signal: f.controller.signal,
        inFlightByDesign: f.running,
        inFlightByWorkspace: f.workspaces,
      });
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = withWorkspaceFileWriter(sourceEntryFile(f.db, f.design.id), async () => {
      entered();
      await hold;
    });
    await started;
    const confirming = run.confirm(true);
    try {
      await expect(otherRun()).rejects.toThrow(/already|progress|running/i);
    } finally {
      release();
    }
    await locked;
    await confirming;
    expect(run.committed).toBe(true);
    await expect(otherRun()).rejects.toThrow(/already|progress|running/i);
    run.dispose();
    const next = await otherRun();
    next.dispose();
    expect(f.workspaces.size).toBe(0);
  });
  it('rejects cancellation after asynchronous validation but before metadata commit', async () => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    const write = sourceEntryStore.writeSourceEntryFile;
    const spy = vi
      .spyOn(sourceEntryStore, 'writeSourceEntryFile')
      .mockImplementation(async (...args) => {
        const validate = args[4];
        args[4] = async () => {
          await validate();
          f.controller.abort();
        };
        return write(...args);
      });
    try {
      await expect(run.confirm(true)).rejects.toThrow();
      expect(run.committed).toBe(false);
      expect(await getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'planned' });
    } finally {
      spy.mockRestore();
      run.dispose();
    }
  });
  it('preserves the committed fact when cancellation arrives after metadata commit', async () => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    const write = sourceEntryStore.writeSourceEntryFile;
    const spy = vi
      .spyOn(sourceEntryStore, 'writeSourceEntryFile')
      .mockImplementation(async (...args) => {
        await write(...args);
        f.controller.abort();
      });
    try {
      await run.confirm(true);
      expect(run.committed).toBe(true);
      expect(await getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'ready', content });
    } finally {
      spy.mockRestore();
      run.dispose();
    }
  });
  it('rejects cancellation while confirmation is queued without committing metadata', async () => {
    const f = await fixture();
    const run = await f.admit();
    const content = '<p>Verified</p>';
    await writeFile(path.join(f.workspace, 'index.html'), content);
    await run.verify(content, { path: 'index.html' }, async () => []);
    await run.accept({ source: SourceIdentityV1.parse(run.source), content });
    let release = () => {};
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = withWorkspaceFileWriter(sourceEntryFile(f.db, f.design.id), async () => {
      entered();
      await hold;
    });
    await started;
    const confirming = run.confirm(true);
    const rejected = expect(confirming).rejects.toThrow();
    f.controller.abort();
    release();
    await locked;
    await rejected;
    expect(run.committed).toBe(false);
    expect(await getSourceEntry(f.db, f.design.id)).toMatchObject({ status: 'planned' });
    run.dispose();
    expect(f.workspaces.size).toBe(0);
  });
  it('ignores notifications with an incorrect old tuple and after disposal', async () => {
    const f = await fixture();
    const run = await f.admit();
    const entry = await getSourceEntry(f.db, f.design.id);
    const before = {
      workspacePath: f.workspace,
      revision: 'wrong-revision',
      source: SourceIdentityV1.parse(run.source),
    };
    const after = {
      workspacePath: path.join(f.root, 'not-renamed'),
      revision: entry.revision,
      source: SourceIdentityV1.parse(run.source),
    };
    notifyAutoManagedSourceRename({ designId: f.design.id, before, after });
    expect(path.normalize(run.workspaceRoot)).toBe(path.normalize(f.workspace));
    expect(await run.withWorkspace(async (root) => path.normalize(root))).toBe(
      path.normalize(f.workspace),
    );
    run.dispose();
    notifyAutoManagedSourceRename({
      designId: f.design.id,
      before: { ...before, revision: entry.revision },
      after,
    });
    expect(f.workspaces.size).toBe(0);
    expect(path.normalize(run.workspaceRoot)).toBe(path.normalize(f.workspace));
  });
  it('uses declared mode for primary and native HTML auxiliary previews only', async () => {
    const f = await fixture();
    const run = await f.admit();
    expect(run.runtimeMode('index.html')).toBe('native-html');
    expect(run.runtimeMode('pages/other.htm')).toBe('native-html');
    expect(run.runtimeMode('pages/other.tsx')).toBe('legacy-auto');
    run.dispose();
  });
  it('does not bless ordinary rebinds or ABA', async () => {
    const f = await fixture();
    const run = await f.admit();
    const next = path.join(f.root, 'other');
    await runWithWorkspaceRenameQueue(f.design.id, async () => {
      await changeSourceEntryWorkspace(f.db, f.design.id, next, true, () =>
        rename(f.workspace, next),
      );
      await changeSourceEntryWorkspace(f.db, f.design.id, f.workspace, true, () =>
        rename(next, f.workspace),
      );
    });
    await expect(run.withWorkspace(async () => undefined)).rejects.toThrow(/changed/i);
    run.dispose();
  });
});
