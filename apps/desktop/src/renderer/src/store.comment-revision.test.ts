import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initI18n } from '@open-codesign/i18n';
import { type CommentApplyResultV1, commentContentFingerprint } from '@open-codesign/shared';
import { beforeAll, expect, it, vi } from 'vitest';
import {
  appendSessionComment,
  listSessionComments,
  markSessionCommentsAppliedIfUnchanged,
  updateSessionComment,
} from '../../main/session-chat';
import { createDesign, initSnapshotsDb, updateDesignWorkspace } from '../../main/snapshots-db';
import type { CodesignApi, GenerateResponse } from '../../preload';
import { useCodesignStore } from './store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeAll(() => initI18n('en'));

it.each([
  'before-completion',
  'before-host-mark',
  'after-host-mark',
  'late-update-ack',
] as const)('keeps changed same-ID edits pending through %s', async (timing) => {
  const root = await mkdtemp(path.join(tmpdir(), 'codesign-comment-revision-'));
  const initial = useCodesignStore.getState();
  const get = useCodesignStore.getState;
  try {
    const db = initSnapshotsDb(path.join(root, 'store.json'));
    const created = createDesign(db, 'Comment revision');
    const design = updateDesignWorkspace(db, created.id, root);
    if (!design) throw new Error('Missing design');
    const opts = { db, sessionDir: db.sessionDir };
    const input = {
      designId: design.id,
      snapshotId: 'before',
      kind: 'edit' as const,
      text: 'Make it red',
      selector: '#heading',
      tag: 'h1',
      outerHTML: '<h1>Heading</h1>',
      rect: { top: 0, left: 0, width: 100, height: 20 },
    };
    const red = appendSessionComment(opts, input);
    const stable = appendSessionComment(opts, {
      ...input,
      text: 'Keep spacing',
      selector: '#body',
    });
    const completion = deferred<GenerateResponse>();
    const markEntered = deferred<void>();
    const hostGate = deferred<void>();
    const ackGate = deferred<void>();
    const hostMarked = deferred<CommentApplyResultV1>();
    const updateGate = deferred<void>();
    const mark = vi.fn<CodesignApi['comments']['markAppliedIfUnchanged']>(
      async (designId, ids, snapshotId, expected) => {
        markEntered.resolve();
        await hostGate.promise;
        const result = markSessionCommentsAppliedIfUnchanged(
          opts,
          designId,
          ids,
          snapshotId,
          expected,
        );
        hostMarked.resolve(result);
        await ackGate.promise;
        return result;
      },
    );
    const generate = vi.fn<CodesignApi['generate']>(() => completion.promise);
    const send = vi.fn<CodesignApi['sendActiveMessage']>(async (input) => ({
      ...input,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }));
    vi.stubGlobal('window', {
      codesign: {
        generate,
        sendActiveMessage: send,
        chat: { list: async () => [] },
        comments: {
          markAppliedIfUnchanged: mark,
          update: async (designId: string, id: string, patch: { text?: string }) => {
            const result = updateSessionComment(opts, designId, id, patch);
            await updateGate.promise;
            return result;
          },
        },
        snapshots: { list: async () => [{ id: 'after' }] },
      },
    });
    useCodesignStore.setState({
      ...initial,
      currentDesignId: design.id,
      designs: [design],
      comments: [red, stable],
      queuedCommentIds: [red.id, stable.id],
      config: {
        hasKey: true,
        provider: 'custom-local',
        modelPrimary: 'frozen',
        baseUrl: null,
        designSystem: null,
      },
      appendChatMessage: vi.fn(async () => null),
      renameDesign: vi.fn(async () => {}),
      tryAutoPolish: vi.fn(),
    });
    const generation = get().sendPrompt({ prompt: 'Apply these edits' });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(generate.mock.calls[0]?.[0].prompt).toContain('Make it red');
    for (const mode of ['follow-up', 'steer'] as const) {
      get().setComposerDraft('Keep working');
      await get().sendActiveMessage('Keep working', mode);
    }
    get().setComposerDraft('Apply the blue revision');
    const revise = () =>
      get().submitComment({
        ...input,
        existingCommentId: red.id,
        text: 'Make it blue',
      });
    if (timing === 'before-completion') {
      updateGate.resolve();
      await revise();
      for (const mode of ['follow-up', 'steer'] as const) {
        await expect(get().sendActiveMessage('Apply the blue revision', mode)).rejects.toThrow(
          'text-only',
        );
        expect(get().composerDrafts[design.id]).toBe('Apply the blue revision');
      }
      expect(send).toHaveBeenCalledTimes(2);
    }
    completion.resolve({ artifacts: [], message: '', inputTokens: 1, outputTokens: 1, costUsd: 0 });
    await markEntered.promise;
    if (timing === 'before-host-mark') {
      updateGate.resolve();
      await revise();
    }
    hostGate.resolve();
    const result = await hostMarked.promise;
    let updating: ReturnType<typeof revise> | undefined;
    if (timing === 'after-host-mark' || timing === 'late-update-ack') {
      if (timing === 'after-host-mark') updateGate.resolve();
      updating = revise();
      if (timing === 'after-host-mark') await updating;
    }
    ackGate.resolve();
    await generation;
    updateGate.resolve();
    await updating;
    expect(mark).toHaveBeenCalledWith(design.id, [red.id, stable.id], 'after', {
      [red.id]: commentContentFingerprint(red),
      [stable.id]: commentContentFingerprint(stable),
    });
    if (timing === 'before-completion' || timing === 'before-host-mark') {
      expect(result.conflictedIds).toEqual([red.id]);
      expect(result.applied.map((row) => row.id)).toEqual([stable.id]);
    }
    const stored = listSessionComments(opts, design.id);
    expect(stored.find((row) => row.id === red.id)).toMatchObject({
      text: 'Make it blue',
      status: 'pending',
      appliedInSnapshotId: null,
    });
    expect(stored.find((row) => row.id === stable.id)?.status).toBe('applied');
    expect(get().comments.find((row) => row.id === red.id)).toMatchObject({
      text: 'Make it blue',
      status: 'pending',
    });
    expect(get().queuedCommentIds).toEqual([red.id]);
    expect(get().composerDrafts[design.id]).toBe('Apply the blue revision');
    expect(get().generationStage).toBe('done');
    expect(get().errorMessage).toBeNull();
    if (timing !== 'late-update-ack') {
      expect(get().toasts.some((toast) => toast.title.includes('kept pending'))).toBe(true);
    }
  } finally {
    useCodesignStore.setState(initial);
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
