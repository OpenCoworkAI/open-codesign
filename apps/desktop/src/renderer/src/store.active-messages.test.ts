import { initI18n } from '@open-codesign/i18n';
import type { ActiveRunMessageInputV1, ActiveRunMessageV1 } from '@open-codesign/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCodesignStore } from './store';

const initial = useCodesignStore.getState();
const get = useCodesignStore.getState;
const generate = vi.fn();
const loadChat = vi.fn(async () => {});
const appendChat = vi.fn();
const send = vi.fn<(input: ActiveRunMessageInputV1) => Promise<ActiveRunMessageV1>>();
const list = vi.fn<(designId: string) => Promise<ActiveRunMessageV1[]>>();
const row = (input: Partial<ActiveRunMessageV1> = {}): ActiveRunMessageV1 => ({
  schemaVersion: 1,
  designId: 'a',
  generationId: 'run-a',
  messageId: 'message-a',
  mode: 'follow-up',
  text: 'Make it warm',
  status: 'pending',
  createdAt: '2026-09-17T00:00:00Z',
  ...input,
});

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  useCodesignStore.setState({
    ...initial,
    currentDesignId: 'a',
    generationByDesign: { a: { generationId: 'run-a', stage: 'thinking', awaitingResponse: true } },
    activeGenerationId: 'run-a',
    generatingDesignId: 'a',
    isGenerating: true,
    composerDrafts: { a: 'Make it warm', b: 'Other draft' },
    loadChatForCurrentDesign: loadChat,
    appendChatMessage: appendChat,
    config: {
      hasKey: true,
      provider: 'custom-local',
      modelPrimary: 'unchanged-model',
      baseUrl: null,
      designSystem: null,
    },
  });
  send.mockImplementation(async (input) => row(input));
  list.mockResolvedValue([]);
  vi.stubGlobal('window', {
    codesign: {
      sendActiveMessage: send,
      listActiveMessages: list,
      generate,
      cancelGeneration: vi.fn(async () => {}),
      generationStatus: vi.fn(async () => ({ schemaVersion: 1, running: [] })),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('active-message store', () => {
  it('queues text in the existing run without changing model or generating another turn', async () => {
    const config = get().config;
    const run = get().generationByDesign['a'];
    await get().sendActiveMessage('Make it warm', 'follow-up');
    expect(send).toHaveBeenCalledWith({
      schemaVersion: 1,
      designId: 'a',
      generationId: 'run-a',
      messageId: expect.any(String),
      mode: 'follow-up',
      text: 'Make it warm',
    });
    expect(get().composerDrafts).toEqual({ a: '', b: 'Other draft' });
    expect(get().activeMessagesByDesign['a']?.[0]?.status).toBe('pending');
    expect(get().config).toBe(config);
    expect(get().generationByDesign['a']).toBe(run);
    expect(generate).not.toHaveBeenCalled();
    expect(appendChat).not.toHaveBeenCalled();
    expect(loadChat).not.toHaveBeenCalled();
  });

  it('retains a rejected draft and exposes the host error through a toast', async () => {
    send.mockRejectedValueOnce(new Error('Run is not ready'));
    await expect(get().sendActiveMessage('Make it warm', 'steer')).rejects.toThrow('not ready');
    expect(get().composerDrafts['a']).toBe('Make it warm');
    expect(get().activeMessagesByDesign['a']).toBeUndefined();
    expect(get().toasts.at(-1)?.description).toBe('Run is not ready');
  });

  it.each([
    { inputFiles: [{ path: 'brief.md', name: 'brief.md', size: 12 }] },
    { referenceUrl: 'https://example.com' },
    { queuedCommentIds: ['comment-a'] },
  ])('rejects unsupported context without clearing it or the draft: %j', async (context) => {
    useCodesignStore.setState(context);
    await expect(get().sendActiveMessage('Make it warm', 'follow-up')).rejects.toThrow('text-only');
    expect(get().composerDrafts['a']).toBe('Make it warm');
    expect(get()).toMatchObject(context);
    expect(send).not.toHaveBeenCalled();
    expect(get().toasts).toHaveLength(1);
  });

  it('preserves edits and other designs while acceptance is in flight', async () => {
    let accept: ((message: ActiveRunMessageV1) => void) | undefined;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const request = get().sendActiveMessage('Make it warm', 'steer');
    get().setComposerDraft('Edited while waiting');
    useCodesignStore.setState({ currentDesignId: 'b' });
    accept?.(row({ mode: 'steer' }));
    await request;
    expect(get().composerDrafts).toEqual({ a: 'Edited while waiting', b: 'Other draft' });
    expect(get().activeMessagesByDesign['b']).toBeUndefined();
  });

  it('clears only the submitted design draft after switching designs', async () => {
    send.mockImplementationOnce(async (input) => {
      useCodesignStore.setState({ currentDesignId: 'b' });
      return row(input);
    });
    await get().sendActiveMessage('Make it warm', 'steer');
    expect(get().composerDrafts).toEqual({ a: '', b: 'Other draft' });
  });

  it('retains sender identity and delivered status across a slow acceptance response', async () => {
    let accept: (() => void) | undefined;
    send.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          accept = () => resolve(row(input));
        }),
    );
    const request = get().sendActiveMessage('Make it warm', 'steer');
    const submitted = send.mock.calls[0]?.[0];
    expect(submitted).toBeDefined();
    if (!submitted) throw new Error('Missing active-message request');
    get().reconcileActiveMessage(row({ ...submitted, status: 'delivered' }));
    useCodesignStore.setState({
      generationByDesign: { a: { generationId: 'new-run', stage: 'thinking' } },
    });
    await get().sendActiveMessage('Make it warm', 'follow-up');
    expect(send).toHaveBeenCalledOnce();
    expect(get().activeMessageSendingByDesign['a']).toBe(true);
    useCodesignStore.setState({ currentDesignId: 'b' });
    accept?.();
    await request;
    expect(get().activeMessagesByDesign['a']).toEqual([row({ ...submitted, status: 'delivered' })]);
    expect(get().activeMessagesByDesign['a']?.[0]).toMatchObject({
      designId: 'a',
      generationId: 'run-a',
      messageId: submitted.messageId,
      mode: 'steer',
    });
    expect(get().composerDrafts).toEqual({ a: '', b: 'Other draft' });
    expect(loadChat).toHaveBeenCalledOnce();
    expect(appendChat).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('passes the full supported 32000-character text without truncation', async () => {
    const text = 'x'.repeat(32_000);
    get().setComposerDraft(text);
    await get().sendActiveMessage(text, 'follow-up');
    expect(send.mock.calls[0]?.[0].text).toBe(text);
    expect(get().activeMessagesByDesign['a']?.[0]?.text).toBe(text);
  });

  it('rejects a stopped run without clearing or resending the draft', async () => {
    useCodesignStore.setState({ generationByDesign: {} });
    await expect(get().sendActiveMessage('Make it warm', 'follow-up')).rejects.toThrow('no longer');
    expect(get().composerDrafts['a']).toBe('Make it warm');
    expect(send).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps a late list response scoped to its design and refreshes canonical delivered chat', async () => {
    list.mockImplementationOnce(async () => {
      useCodesignStore.setState({ currentDesignId: 'b' });
      return [row({ status: 'not-delivered' })];
    });
    await get().syncActiveMessages('a');
    expect(get().activeMessagesByDesign['a']?.[0]?.status).toBe('not-delivered');
    expect(get().activeMessagesByDesign['b']).toBeUndefined();
    expect(loadChat).not.toHaveBeenCalled();
    list.mockResolvedValueOnce([row({ designId: 'b', status: 'delivered' })]);
    await get().syncActiveMessages('b');
    expect(loadChat).toHaveBeenCalledOnce();
  });

  it('shows list failures through the toast path without losing known rows', async () => {
    useCodesignStore.setState({ activeMessagesByDesign: { a: [row()] } });
    list.mockRejectedValueOnce(new Error('Disconnected'));
    await get().syncActiveMessages('a');
    expect(get().activeMessagesByDesign['a']).toEqual([row()]);
    expect(get().toasts.at(-1)?.description).toBe('Disconnected');
  });

  it('reloads canonical chat on delivery, without appending a duplicate row', async () => {
    await get().sendActiveMessage('Make it warm', 'follow-up');
    const pending = get().activeMessagesByDesign['a']?.[0];
    expect(pending).toBeDefined();
    get().reconcileActiveMessage(row({ ...pending, status: 'delivered' }));
    expect(loadChat).toHaveBeenCalledOnce();
    expect(appendChat).not.toHaveBeenCalled();
    get().reconcileActiveMessage(row({ ...pending }));
    expect(get().activeMessagesByDesign['a']?.[0]?.status).toBe('delivered');
    expect(generate).not.toHaveBeenCalled();
  });

  it('ignores unknown stale events and isolates known background messages', () => {
    get().reconcileActiveMessage(row({ generationId: 'old-run' }));
    expect(get().activeMessagesByDesign['a']).toBeUndefined();
    useCodesignStore.setState({ activeMessagesByDesign: { a: [row()] }, currentDesignId: 'b' });
    get().reconcileActiveMessage(row({ status: 'delivered' }));
    expect(get().activeMessagesByDesign['a']?.[0]?.status).toBe('delivered');
    expect(get().activeMessagesByDesign['b']).toBeUndefined();
    expect(loadChat).not.toHaveBeenCalled();
  });

  it('keeps a terminal event that races cancellation and acceptance recoverable', async () => {
    send.mockImplementationOnce(async (input) => {
      useCodesignStore.setState({ generationByDesign: {} });
      get().reconcileActiveMessage(row({ ...input, status: 'not-delivered', reason: 'Stopped' }));
      return row(input);
    });
    await expect(get().sendActiveMessage('Make it warm', 'follow-up')).rejects.toThrow('Stopped');
    const pending = get().activeMessagesByDesign['a']?.[0];
    expect(pending?.status).toBe('not-delivered');
    expect(get().composerDrafts['a']).toBe('Make it warm');
    get().setComposerDraft('');
    get().recoverActiveMessage('a', pending?.messageId ?? '');
    expect(get().composerDrafts['a']).toBe('Make it warm');
    expect(send).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
  });

  it('treats a not-delivered ACK as failure and keeps both draft and recovery row', async () => {
    send.mockImplementationOnce(async (input) =>
      row({ ...input, status: 'not-delivered', reason: 'Run has shut down' }),
    );
    await expect(get().sendActiveMessage('Make it warm', 'steer')).rejects.toThrow('shut down');
    expect(get().composerDrafts['a']).toBe('Make it warm');
    expect(get().activeMessagesByDesign['a']?.[0]?.status).toBe('not-delivered');
    expect(get().toasts.at(-1)?.description).toBe('Run has shut down');
    expect(generate).not.toHaveBeenCalled();
  });

  it('hydrates prior-generation terminal rows for the selected design without replay', async () => {
    list.mockResolvedValueOnce([
      row({ generationId: 'previous-run', status: 'not-delivered' }),
      row({ generationId: 'previous-run', messageId: 'previous-delivered', status: 'delivered' }),
    ]);
    await get().syncActiveMessages('a');
    expect(get().activeMessagesByDesign['a']).toHaveLength(2);
    get().setComposerDraft('');
    get().recoverActiveMessage('a', 'message-a');
    expect(get().composerDrafts['a']).toBe('Make it warm');
    expect(loadChat).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('syncs persisted interrupted messages after Stop and never replays them', async () => {
    useCodesignStore.setState({ activeMessagesByDesign: { a: [row()] } });
    list.mockResolvedValue([row({ status: 'not-delivered', reason: 'Stopped' })]);
    get().cancelGeneration();
    await vi.waitFor(() =>
      expect(get().activeMessagesByDesign['a']?.[0]?.status).toBe('not-delivered'),
    );
    expect(get().generationByDesign['a']).toBeUndefined();
    get().recoverActiveMessage('a', 'message-a');
    expect(get().composerDrafts['a']).toBe('Make it warm\n\nMake it warm');
    expect(send).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('reconciles a reconnect list without downgrading delivered to pending', async () => {
    useCodesignStore.setState({ activeMessagesByDesign: { a: [row({ status: 'delivered' })] } });
    list.mockResolvedValue([row(), row({ messageId: 'interrupted', status: 'not-delivered' })]);
    await get().syncGenerationStatus();
    expect(list).toHaveBeenCalledWith('a');
    expect(get().activeMessagesByDesign['a']?.map((message) => message.status)).toEqual([
      'delivered',
      'not-delivered',
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
