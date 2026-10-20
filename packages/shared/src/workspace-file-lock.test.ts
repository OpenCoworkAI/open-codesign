import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { withWorkspaceFileWriter } from './workspace-file-lock';

describe('workspace file writer coordination', () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('coordinates workspace aliases, including missing children, without blocking other files', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codesign-file-lock-'));
    const workspace = path.join(root, 'workspace');
    const alias = path.join(root, 'alias');
    await mkdir(workspace);
    await symlink(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = (): void => {};
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const order: string[] = [];
    const first = withWorkspaceFileWriter(path.join(workspace, 'nested', 'App.jsx'), async () => {
      order.push('first');
      started();
      await gate;
      await mkdir(path.join(workspace, 'nested'));
      await writeFile(path.join(workspace, 'nested', 'App.jsx'), 'first');
    });
    await entered;
    const aliasedFile = path.join(alias, 'nested', 'App.jsx');
    const second = withWorkspaceFileWriter(
      process.platform === 'win32' ? aliasedFile.toUpperCase() : aliasedFile,
      async () => {
        order.push('second');
      },
    );
    try {
      await withWorkspaceFileWriter(path.join(workspace, 'Other.jsx'), async () => {
        order.push('other');
      });
      await setImmediate();
      expect(order).toEqual(['first', 'other']);
    } finally {
      release();
    }
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'other', 'second']);
  });

  it('releases after a writer fails', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codesign-file-lock-failure-'));
    const file = path.join(root, 'App.jsx');
    await expect(
      withWorkspaceFileWriter(file, async () => {
        throw new Error('publication failed');
      }),
    ).rejects.toThrow('publication failed');
    await expect(withWorkspaceFileWriter(file, async () => 'saved')).resolves.toBe('saved');
  });

  it('releases when a running writer observes cancellation', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'codesign-file-lock-abort-'));
    const file = path.join(root, 'App.jsx');
    const controller = new AbortController();
    await expect(
      withWorkspaceFileWriter(file, async () => {
        controller.abort();
        controller.signal.throwIfAborted();
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(withWorkspaceFileWriter(file, async () => 'saved')).resolves.toBe('saved');
  });
});
