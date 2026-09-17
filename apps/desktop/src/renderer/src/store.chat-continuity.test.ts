import { initI18n } from '@open-codesign/i18n';
import type {
  ActiveRunMessageInputV1,
  ChatAppendInput,
  ChatMessageRow,
  ChatToolCallPayload,
} from '@open-codesign/shared';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { CodesignApi, GenerateResponse } from '../../preload';
import { useCodesignStore } from './store';

const initial = useCodesignStore.getState();
const get = useCodesignStore.getState;
const set = useCodesignStore.setState;
const design = {
  schemaVersion: 1 as const,
  id: 'a',
  name: 'Continuity',
  workspacePath: 'C:\\synthetic-continuity',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  thumbnailText: null,
  deletedAt: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function row(seq: number, text = `message ${seq}`): ChatMessageRow {
  return {
    schemaVersion: 1,
    id: seq,
    designId: 'a',
    seq,
    kind: 'user',
    payload: { text },
    snapshotId: null,
    createdAt: design.createdAt,
  };
}
const list = vi.fn<() => Promise<ChatMessageRow[]>>();
const append = vi.fn(async (input: ChatAppendInput) => ({ ...row(10), ...input }));
const generate = vi.fn<CodesignApi['generate']>(() => new Promise(() => {}));
const send = vi.fn(async (input: ActiveRunMessageInputV1) => ({
  ...input,
  status: 'pending' as const,
  createdAt: design.createdAt,
}));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  list.mockReset().mockResolvedValue([]);
  set({
    ...initial,
    currentDesignId: 'a',
    designs: [design, { ...design, id: 'b', workspacePath: 'C:\\synthetic-other' }],
    config: {
      hasKey: true,
      provider: 'custom-local',
      modelPrimary: 'frozen-model',
      baseUrl: null,
      designSystem: null,
    },
    renameDesign: vi.fn(async () => {}),
    tryAutoPolish: vi.fn(),
  });
  vi.stubGlobal('window', {
    codesign: {
      generate,
      sendActiveMessage: send,
      snapshots: { list: vi.fn(async () => []) },
      comments: { list: vi.fn(async () => []) },
      chat: {
        list,
        append,
        seedFromSnapshots: vi.fn(async () => {}),
        updateToolStatus: vi.fn(async () => {}),
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  set(initial);
});

it.each([
  'reference',
  'comments',
] as const)('allows queue and steer after a real %s send without consuming new context', async (context) => {
  const completion = deferred<GenerateResponse>();
  generate.mockReturnValueOnce(completion.promise);
  if (context === 'reference') get().setReferenceUrl(' https://example.com/reference ');
  else {
    set({
      comments: [
        {
          schemaVersion: 1,
          id: 'edit-a',
          designId: 'a',
          snapshotId: 'snapshot-a',
          kind: 'edit',
          status: 'pending',
          text: 'Make the heading warm',
          createdAt: design.createdAt,
          selector: '#heading',
          tag: 'h1',
          outerHTML: '<h1>Heading</h1>',
          rect: { top: 0, left: 0, width: 100, height: 20 },
          appliedInSnapshotId: null,
        },
      ],
      queuedCommentIds: ['edit-a'],
    });
  }
  const config = get().config;
  const generation = get().sendPrompt({ prompt: 'Use this context' });
  await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
  if (context === 'reference') {
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ referenceUrl: 'https://example.com/reference' }),
    );
    expect(get().referenceUrl).toBe(' https://example.com/reference ');
  } else {
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('Make the heading warm') }),
    );
    expect(get().queuedCommentIds).toEqual(['edit-a']);
  }
  const run = get().generationByDesign['a'];
  for (const mode of ['follow-up', 'steer'] as const) {
    get().setComposerDraft('Keep going');
    await get().sendActiveMessage('Keep going', mode);
    expect(get().composerDrafts['a']).toBe('');
    expect(send).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      designId: 'a',
      generationId: run?.generationId,
      messageId: expect.any(String),
      text: 'Keep going',
      mode,
    });
  }
  expect(get().config).toBe(config);
  expect(get().generationByDesign['a']).toBe(run);
  expect(generate).toHaveBeenCalledOnce();
  expect(append).toHaveBeenCalledOnce();
  expect(get().comments.every((comment) => comment.status === 'pending')).toBe(true);
  get().setComposerDraft('Retain me');
  if (context === 'reference') get().setReferenceUrl('https://example.com/new');
  else get().queueCommentForPrompt('new-edit');
  await expect(get().sendActiveMessage('Retain me', 'steer')).rejects.toThrow('text-only');
  expect(get().composerDrafts['a']).toBe('Retain me');
  expect(send).toHaveBeenCalledTimes(2);
  const api = window.codesign;
  if (!api) throw new Error('Missing test IPC');
  if (context === 'comments') {
    api.snapshots.list = vi.fn<CodesignApi['snapshots']['list']>(async () => [
      {
        schemaVersion: 1,
        id: 'applied-snapshot',
        designId: 'a',
        parentId: null,
        type: 'edit',
        prompt: null,
        artifactType: 'html',
        artifactSource: '<main>Done</main>',
        createdAt: design.createdAt,
      },
    ]);
    api.comments.markApplied = vi.fn(async (_designId, ids, appliedInSnapshotId) =>
      get()
        .comments.filter((comment) => ids.includes(comment.id))
        .map((comment) => ({ ...comment, status: 'applied' as const, appliedInSnapshotId })),
    );
  }
  completion.resolve({ artifacts: [], message: '', inputTokens: 1, outputTokens: 1, costUsd: 0 });
  await generation;
  expect(get().generationByDesign['a']).toBeUndefined();
  expect(get().composerDrafts['a']).toBe('Retain me');
  if (context === 'comments') {
    expect(api.comments.markApplied).toHaveBeenCalledWith('a', ['edit-a'], 'applied-snapshot');
    expect(get().queuedCommentIds).toEqual(['new-edit']);
    expect(get().comments[0]?.status).toBe('applied');
  } else {
    expect(get().referenceUrl).toBe('https://example.com/new');
  }
});

it('never implicitly attaches files after a context-bearing normal send', async () => {
  get().setReferenceUrl('https://example.com');
  void get().sendPrompt({ prompt: 'Start' });
  await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
  set({ inputFiles: [{ path: 'brief.md', name: 'brief.md', size: 10 }] });
  get().setComposerDraft('Keep this draft');
  await expect(get().sendActiveMessage('Keep this draft', 'follow-up')).rejects.toThrow(
    'text-only',
  );
  expect(get().inputFiles).toHaveLength(1);
  expect(get().composerDrafts['a']).toBe('Keep this draft');
  expect(send).not.toHaveBeenCalled();
});

it('does not let an older list hide a canonical delivered instruction', async () => {
  const old = deferred<ChatMessageRow[]>();
  list.mockReturnValueOnce(old.promise).mockResolvedValueOnce([row(1), row(2, 'Delivered')]);
  set({ generationByDesign: { a: { generationId: 'run', stage: 'thinking' } } });
  const slowLoad = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  get().reconcileActiveMessage({
    schemaVersion: 1,
    designId: 'a',
    generationId: 'run',
    messageId: 'active',
    mode: 'steer',
    text: 'Delivered',
    status: 'delivered',
    createdAt: design.createdAt,
  });
  await vi.waitFor(() => expect(get().chatMessages).toEqual([row(1), row(2, 'Delivered')]));
  old.resolve([row(1)]);
  await slowLoad;
  expect(get().chatMessages).toEqual([row(1), row(2, 'Delivered')]);
  expect(get().activeMessagesByDesign['a']?.[0]?.status).toBe('delivered');
  expect(append).not.toHaveBeenCalled();
});

it('orders chat reads by dispatch after reversed seed completion', async () => {
  const seed = deferred<void>();
  const olderRead = deferred<ChatMessageRow[]>();
  const api = window.codesign;
  if (!api) throw new Error('Missing IPC');
  api.chat.seedFromSnapshots = vi
    .fn()
    .mockReturnValueOnce(seed.promise)
    .mockResolvedValue(undefined);
  list.mockReturnValueOnce(olderRead.promise).mockResolvedValueOnce([row(1), row(2)]);
  const first = get().loadChatForCurrentDesign();
  const second = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  seed.resolve();
  await first;
  expect(get().chatMessages).toEqual([row(1), row(2)]);
  olderRead.resolve([row(1)]);
  await second;
  expect(get().chatMessages).toEqual([row(1), row(2)]);
});

it('reconciles initial history with intervening append and deduplicates a later list', async () => {
  const old = deferred<ChatMessageRow[]>();
  list.mockReturnValueOnce(old.promise);
  const loading = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  const appended = await get().appendChatMessage({
    designId: 'a',
    kind: 'user',
    payload: { text: 'New prompt' },
  });
  old.resolve([row(1), row(2)]);
  await loading;
  expect(get().chatMessages).toEqual([row(1), row(2), appended]);
  if (!appended) throw new Error('Missing appended row');
  list.mockResolvedValueOnce([row(1), row(2), appended]);
  await get().loadChatForCurrentDesign();
  expect(get().chatMessages).toHaveLength(3);
  expect(list).toHaveBeenCalledTimes(2);
});

it.each([
  false,
  true,
])('preserves tool patches racing history, including a not-yet-loaded row (visible=%s)', async (visible) => {
  const tool: ChatMessageRow = {
    ...row(2),
    kind: 'tool_call',
    payload: { toolName: 'read', status: 'running' },
  };
  if (visible) set({ chatMessages: [row(1), tool], chatLoaded: true });
  const old = deferred<ChatMessageRow[]>();
  list.mockReturnValueOnce(old.promise);
  const loading = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  await get().updateChatToolStatus({
    designId: 'a',
    seq: 2,
    status: 'done',
    result: { text: 'Read successfully' },
    durationMs: 12,
  });
  old.resolve([row(1), tool]);
  await loading;
  expect(get().chatMessages).toHaveLength(2);
  expect(get().chatMessages[1]?.payload).toMatchObject({
    status: 'done',
    durationMs: 12,
    result: { text: 'Read successfully' },
  } satisfies Partial<ChatToolCallPayload>);
  expect(list).toHaveBeenCalledOnce();
});

it('publishes useful earlier history even while a newer load is pending', async () => {
  const first = deferred<ChatMessageRow[]>();
  const second = deferred<ChatMessageRow[]>();
  list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const loadingFirst = get().loadChatForCurrentDesign();
  const loadingSecond = get().loadChatForCurrentDesign();
  first.resolve([row(1)]);
  await loadingFirst;
  expect(get().chatMessages).toEqual([row(1)]);
  second.resolve([row(1), row(2)]);
  await loadingSecond;
  expect(get().chatMessages).toEqual([row(1), row(2)]);
});

it('replays the newest acknowledged tool patch and releases it after publication', async () => {
  const tool: ChatMessageRow = {
    ...row(2),
    kind: 'tool_call',
    payload: { toolName: 'read', status: 'running' },
  };
  const old = deferred<ChatMessageRow[]>();
  list.mockReturnValueOnce(old.promise);
  const loading = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  await get().updateChatToolStatus({ designId: 'a', seq: 2, status: 'done' });
  await get().updateChatToolStatus({
    designId: 'a',
    seq: 2,
    status: 'error',
    errorMessage: 'Final result',
  });
  old.resolve([row(1), tool]);
  await loading;
  expect(get().chatMessages[1]?.payload).toMatchObject({
    status: 'error',
    error: { message: 'Final result' },
  });
  // A subsequent authoritative read must not inherit already-consumed patches.
  list.mockResolvedValueOnce([row(1), { ...tool, payload: { toolName: 'read', status: 'done' } }]);
  await get().loadChatForCurrentDesign();
  expect(get().chatMessages[1]?.payload).toMatchObject({ status: 'done' });
});

it('deduplicates a slow append ACK against a listed and patched canonical row', async () => {
  const appended = deferred<ChatMessageRow>();
  append.mockReturnValueOnce(appended.promise);
  const tool: ChatMessageRow = {
    ...row(2),
    kind: 'tool_call',
    payload: { toolName: 'read', status: 'running' },
  };
  const appending = get().appendChatMessage({
    designId: 'a',
    kind: 'tool_call',
    payload: tool.payload,
  });
  list.mockResolvedValueOnce([row(1), tool]);
  await get().loadChatForCurrentDesign();
  await get().updateChatToolStatus({ designId: 'a', seq: 2, status: 'done' });
  appended.resolve(tool);
  await appending;
  expect(get().chatMessages).toHaveLength(2);
  expect(get().chatMessages[1]?.payload).toMatchObject({ status: 'done' });
});

it.each([false, true])('orders successful tool-status ACKs (newer fails=%s)', async (fails) => {
  const tool: ChatMessageRow = {
    ...row(2),
    kind: 'tool_call',
    payload: { toolName: 'read', status: 'running' },
  };
  set({ chatMessages: [row(1), tool] });
  const oldList = deferred<ChatMessageRow[]>();
  const oldUpdate = deferred<void>();
  const api = window.codesign;
  if (!api) throw new Error('Missing test IPC');
  const update = vi.fn().mockReturnValueOnce(oldUpdate.promise);
  if (fails) update.mockRejectedValueOnce(new Error('Latest update failed'));
  api.chat.updateToolStatus = update;
  list.mockReturnValueOnce(oldList.promise);
  const loading = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  const updating = get().updateChatToolStatus({ designId: 'a', seq: 2, status: 'done' });
  await get().updateChatToolStatus({
    designId: 'a',
    seq: 2,
    status: 'error',
    errorMessage: 'Latest update',
  });
  oldUpdate.resolve();
  await updating;
  expect(get().chatMessages[1]?.payload).toMatchObject({ status: fails ? 'done' : 'error' });
  oldList.resolve([row(1), tool]);
  await loading;
  expect(get().chatMessages[1]?.payload).toMatchObject({ status: fails ? 'done' : 'error' });
});

it('retains the UI row bound after reconciling a large initial history', async () => {
  const old = deferred<ChatMessageRow[]>();
  list.mockReturnValueOnce(old.promise);
  const loading = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
  append.mockResolvedValueOnce(row(231));
  await get().appendChatMessage({ designId: 'a', kind: 'user', payload: { text: 'Latest' } });
  old.resolve(Array.from({ length: 230 }, (_, index) => row(index + 1)));
  await loading;
  expect(get().chatMessages).toHaveLength(220);
  expect(get().chatMessages[0]?.seq).toBe(12);
  expect(get().chatMessages.at(-1)?.seq).toBe(231);
});

it('invalidates old A loads across real A -> B -> A switches before the new load resolves', async () => {
  const oldA = deferred<ChatMessageRow[]>();
  const newB = deferred<ChatMessageRow[]>();
  const newA = deferred<ChatMessageRow[]>();
  list
    .mockReturnValueOnce(oldA.promise)
    .mockReturnValueOnce(newB.promise)
    .mockReturnValueOnce(newA.promise);
  const loading = get().loadChatForCurrentDesign();
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await get().switchDesign('b');
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await get().switchDesign('a');
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  oldA.resolve([row(1)]);
  await loading;
  expect(get().chatMessages).toEqual([]);
  expect(get().chatLoaded).toBe(false);
  newA.resolve([row(1), row(2)]);
  await vi.waitFor(() => expect(get().chatMessages).toEqual([row(1), row(2)]));
  newB.resolve([{ ...row(3), designId: 'b' }]);
  await Promise.resolve();
  expect(get().chatMessages).toEqual([row(1), row(2)]);
});
